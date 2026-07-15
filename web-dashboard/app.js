const host = window.location.hostname || "10.0.0.135";
const websocketUrl = `ws://${host}:8765`;
const videoUrl = `http://${host}:8889/cam`;

let socket = null;
let steering = 0;
let throttle = 0;
let speedLimit = 0.5;
const speedStep = 0.1;
const pressedKeys = new Set();

const connectionDot = document.getElementById("connectionDot");
const connectionText = document.getElementById("connectionText");
const connectButton = document.getElementById("connectButton");
const stopButton = document.getElementById("stopButton");
const logElement = document.getElementById("log");
const videoFrame = document.getElementById("videoFrame");
const throttleSlider = document.getElementById("throttleSlider");
const steeringSlider = document.getElementById("steeringSlider");
const throttleValue = document.getElementById("throttleValue");
const steeringValue = document.getElementById("steeringValue");
const driveStrength = document.getElementById("driveStrength");
const steeringStrength = document.getElementById("steeringStrength");

videoFrame.src = videoUrl;

function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  logElement.textContent += `\n[${timestamp}] ${message}`;
  logElement.scrollTop = logElement.scrollHeight;
}

function setConnectionState(connected) {
  connectionDot.classList.toggle("connected", connected);
  connectionText.textContent = connected ? "Connected" : "Disconnected";
  connectButton.textContent = connected ? "Disconnect" : "Connect";
}

function connect() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    stopVehicle();
    socket.close();
    return;
  }

  log(`Connecting to ${websocketUrl}`);
  socket = new WebSocket(websocketUrl);

  socket.addEventListener("open", () => {
    setConnectionState(true);
    log("WebSocket connected.");
    sendCommand();
  });

  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.accepted) {
        log(
          `Accepted: steering ${Number(message.steering).toFixed(2)}, ` +
          `throttle ${Number(message.throttle).toFixed(2)}`
        );
      } else {
        log(`Rejected: ${message.error}`);
      }
    } catch {
      log(`Received: ${event.data}`);
    }
  });

  socket.addEventListener("close", () => {
    setConnectionState(false);
    resetControls();
    log("WebSocket disconnected.");
  });

  socket.addEventListener("error", () => {
    log("WebSocket error.");
  });
}

function updateDisplay() {
  throttleSlider.value = throttle;
  steeringSlider.value = steering;
  throttleValue.textContent = throttle.toFixed(2);
  steeringValue.textContent = steering.toFixed(2);
}

function sendCommand() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({ steering, throttle }));
}

function resetControls() {
  steering = 0;
  throttle = 0;
  pressedKeys.clear();
  document.querySelectorAll(".drive-button").forEach((button) => {
    button.classList.remove("active");
  });
  updateDisplay();
}

function stopVehicle() {
  resetControls();
  sendCommand();
  log("STOP command sent.");
}

function recalculateFromKeys() {
  const drive = speedLimit;
  const turn = Number(steeringStrength.value);

  throttle =
    (pressedKeys.has("w") ? drive : 0) +
    (pressedKeys.has("s") ? -drive : 0);

  steering =
    (pressedKeys.has("d") ? turn : 0) +
    (pressedKeys.has("a") ? -turn : 0);

  throttle = Math.max(-1, Math.min(1, throttle));
  steering = Math.max(-1, Math.min(1, steering));
  updateDisplay();
}

function setPressed(control, isPressed) {
  const keyMap = {
    forward: "w",
    reverse: "s",
    left: "a",
    right: "d",
  };

  const key = keyMap[control];
  if (isPressed) {
    pressedKeys.add(key);
  } else {
    pressedKeys.delete(key);
  }

  const button = document.querySelector(`[data-control="${control}"]`);
  button?.classList.toggle("active", isPressed);
  recalculateFromKeys();
}

function updateSpeedIndicator() {
  const percent = Math.round(speedLimit * 100);
  const angle = speedLimit * 360;

  speedPercent.textContent = `${percent}%`;
  speedRing.style.setProperty("--speed-angle", `${angle}deg`);
}

connectButton.addEventListener("click", connect);
stopButton.addEventListener("click", stopVehicle);

document.getElementById("reloadVideoButton").addEventListener("click", () => {
  videoFrame.src = videoUrl;
  log("Video frame reloaded.");
});

document.getElementById("clearLogButton").addEventListener("click", () => {
  logElement.textContent = "Log cleared.";
});

const speedRing = document.getElementById("speedRing");
const speedPercent = document.getElementById("speedPercent");

throttleSlider.addEventListener("input", () => {
  throttle = Number(throttleSlider.value);
  updateDisplay();
});

steeringSlider.addEventListener("input", () => {
  steering = Number(steeringSlider.value);
  updateDisplay();
});

for (const button of document.querySelectorAll(".drive-button")) {
  const control = button.dataset.control;

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    setPressed(control, true);
  });

  button.addEventListener("pointerup", () => setPressed(control, false));
  button.addEventListener("pointercancel", () => setPressed(control, false));
  button.addEventListener("lostpointercapture", () => setPressed(control, false));
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  
  if (key === "arrowup") {
    event.preventDefault();

    speedLimit = Math.min(1, speedLimit + speedStep);
    updateSpeedIndicator();
    recalculateFromKeys();

    log(`Top speed set to ${Math.round(speedLimit * 100)}%`);
    return;
  }

  if (key === "arrowdown") {
    event.preventDefault();

    speedLimit = Math.max(0, speedLimit - speedStep);
    updateSpeedIndicator();
    recalculateFromKeys();

    log(`Top speed set to ${Math.round(speedLimit * 100)}%`);
    return;
  }

  if (!["w", "a", "s", "d"].includes(key)) {
    return;
  }

  event.preventDefault();
  pressedKeys.add(key);
  document
    .querySelector(`[data-control="${
      { w: "forward", a: "left", s: "reverse", d: "right" }[key]
    }"]`)
    ?.classList.add("active");

  recalculateFromKeys();
});

window.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  if (!["w", "a", "s", "d"].includes(key)) {
    return;
  }

  pressedKeys.delete(key);
  document
    .querySelector(`[data-control="${
      { w: "forward", a: "left", s: "reverse", d: "right" }[key]
    }"]`)
    ?.classList.remove("active");

  recalculateFromKeys();
});

window.addEventListener("blur", stopVehicle);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopVehicle();
  }
});

// Send the latest command 10 times per second.
// This keeps control responsive and makes key releases reach the Pi quickly.
setInterval(sendCommand, 100);

updateDisplay();
updateSpeedIndicator();
setConnectionState(false);
log(`Video URL: ${videoUrl}`);
log(`WebSocket URL: ${websocketUrl}`);
