
// Use the hostname that served the webpage.
// The fallback IP is mainly useful if window.location.hostname is unavailable.
const host = window.location.hostname || "10.0.0.135";

const websocketUrl = `ws://${host}:8765`;
const videoUrl = `http://${host}:8889/cam`;

// Amount the top-speed limit changes with each arrow-key press.
const speedStep = 0.1;

// Send the current command to the Raspberry Pi every 100 ms.
const commandSendInterval = 100;


// ~~~~~~~~~~~~~~ Application State ~~~~~~~~~~~~~~~~~~~~~~~~~~~~

let socket = null;

// Current normalized vehicle commands.
// Both values should remain between -1.0 and 1.0.
let steering = 0;
let throttle = 0;

// Maximum forward or reverse throttle used by the keyboard controls.
let speedLimit = 0.5;

// Tracks all currently held WASD keys.
// A Set allows multiple keys to be held simultaneously.
const pressedKeys = new Set();


// ~~~~~~~~~~~~~~ DOM Elements ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Connection controls.
const connectionDot = document.getElementById("connectionDot");
const connectionText = document.getElementById("connectionText");
const connectButton = document.getElementById("connectButton");

// Vehicle controls.
const stopButton = document.getElementById("stopButton");
const throttleSlider = document.getElementById("throttleSlider");
const steeringSlider = document.getElementById("steeringSlider");
const driveStrength = document.getElementById("driveStrength");
const steeringStrength = document.getElementById("steeringStrength");

// Current command displays.
const throttleValue = document.getElementById("throttleValue");
const steeringValue = document.getElementById("steeringValue");

// Speed indicator.
const speedRing = document.getElementById("speedRing");
const speedPercent = document.getElementById("speedPercent");

// Video and log elements.
const videoFrame = document.getElementById("videoFrame");
const logElement = document.getElementById("log");


// ~~~~~~~~~~ Logging and UI Updates ~~~~~~~~~~~~~~~~~~~~

/**
 * Add a timestamped message to the dashboard log.
 */
function log(message) {
  const timestamp = new Date().toLocaleTimeString();

  logElement.textContent += `\n[${timestamp}] ${message}`;
  logElement.scrollTop = logElement.scrollHeight;
}

/**
 * Update the connection indicator and connect-button label.
 */
function setConnectionState(connected) {
  connectionDot.classList.toggle("connected", connected);
  connectionText.textContent = connected ? "Connected" : "Disconnected";
  connectButton.textContent = connected ? "Disconnect" : "Connect";
}

/**
 * Update the sliders and numeric command displays.
 */
function updateDisplay() {
  throttleSlider.value = throttle;
  steeringSlider.value = steering;

  throttleValue.textContent = throttle.toFixed(2);
  steeringValue.textContent = steering.toFixed(2);
}

/**
 * Update the circular top-speed indicator.
 */
function updateSpeedIndicator() {
  const percent = Math.round(speedLimit * 100);
  const angle = speedLimit * 360;

  speedPercent.textContent = `${percent}%`;
  speedRing.style.setProperty("--speed-angle", `${angle}deg`);
}


// ~~~~~~~~~~~~~~ WebSocket Connection ~~~~~~~~~~~~~~~~~~~~~~~~~

/**
 * Connect to or disconnect from the Raspberry Pi WebSocket server.
 */
function connect() {
  // If already connected, use the same button to disconnect.
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

    // Send the current command immediately after connecting.
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
      // Handle plain-text messages that are not JSON.
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

/**
 * Send the current steering and throttle values to the Pi.
 */
function sendCommand() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const command = {
    steering,
    throttle,
  };

  socket.send(JSON.stringify(command));
}


// ~~~~~~~~~~~~~~~~~ Vehicle Command Handling ~~~~~~~~~~~~~~~~

/**
 * Reset throttle, steering, pressed keys, and button highlights.
 */
function resetControls() {
  steering = 0;
  throttle = 0;

  pressedKeys.clear();

  document.querySelectorAll(".drive-button").forEach((button) => {
    button.classList.remove("active");
  });

  updateDisplay();
}

/**
 * Immediately reset the controls and send a zero command.
 */
function stopVehicle() {
  resetControls();
  sendCommand();
  log("STOP command sent.");
}

/**
 * Calculate throttle and steering based on the currently held keys.
 */
function recalculateFromKeys() {
  // Keyboard throttle uses the adjustable top-speed limit.
  const drive = speedLimit;

  // Keyboard steering uses the steering-strength dropdown.
  const turn = Number(steeringStrength.value);

  throttle =
    (pressedKeys.has("w") ? drive : 0) +
    (pressedKeys.has("s") ? -drive : 0);

  steering =
    (pressedKeys.has("d") ? turn : 0) +
    (pressedKeys.has("a") ? -turn : 0);

  // Keep both commands within the valid normalized range.
  throttle = Math.max(-1, Math.min(1, throttle));
  steering = Math.max(-1, Math.min(1, steering));

  updateDisplay();
}

/**
 * Handle an on-screen drive button being pressed or released.
 */
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

  const button = document.querySelector(
    `[data-control="${control}"]`
  );

  button?.classList.toggle("active", isPressed);

  recalculateFromKeys();
}


// ~~~~~~~~~~~~~~ Main Button Event Listeners ~~~~~~~~~~~~~

connectButton.addEventListener("click", connect);
stopButton.addEventListener("click", stopVehicle);

document
  .getElementById("reloadVideoButton")
  .addEventListener("click", () => {
    videoFrame.src = videoUrl;
    log("Video frame reloaded.");
  });

document
  .getElementById("clearLogButton")
  .addEventListener("click", () => {
    logElement.textContent = "Log cleared.";
  });


// ~~~~~~~~~~~~~~ Slider Event Listeners ~~~~~~~~~~~~~~~~~

throttleSlider.addEventListener("input", () => {
  throttle = Number(throttleSlider.value);
  updateDisplay();
});

steeringSlider.addEventListener("input", () => {
  steering = Number(steeringSlider.value);
  updateDisplay();
});


// ~~~~~~~~~~~~~~ Touch and Pointer Controls ~~~~~~~~~~~~~~~

for (const button of document.querySelectorAll(".drive-button")) {
  const control = button.dataset.control;

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();

    // Keep receiving pointer events even if the pointer moves off the button.
    button.setPointerCapture(event.pointerId);

    setPressed(control, true);
  });

  button.addEventListener("pointerup", () => {
    setPressed(control, false);
  });

  button.addEventListener("pointercancel", () => {
    setPressed(control, false);
  });

  button.addEventListener("lostpointercapture", () => {
    setPressed(control, false);
  });
}


// ~~~~~~~~~~~~~~ Keyboard Controls ~~~~~~~~~~~~~~~~~~~~~~

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  // Increase the keyboard throttle limit.
  if (key === "arrowup") {
    event.preventDefault();

    speedLimit = Math.min(1, speedLimit + speedStep);

    updateSpeedIndicator();
    recalculateFromKeys();

    log(`Top speed set to ${Math.round(speedLimit * 100)}%`);
    return;
  }

  // Decrease the keyboard throttle limit.
  if (key === "arrowdown") {
    event.preventDefault();

    speedLimit = Math.max(0, speedLimit - speedStep);

    updateSpeedIndicator();
    recalculateFromKeys();

    log(`Top speed set to ${Math.round(speedLimit * 100)}%`);
    return;
  }

  // Ignore keyboard keys other than WASD.
  if (!["w", "a", "s", "d"].includes(key)) {
    return;
  }

  event.preventDefault();

  pressedKeys.add(key);

  const controlMap = {
    w: "forward",
    a: "left",
    s: "reverse",
    d: "right",
  };

  // Highlight the matching on-screen button.
  document
    .querySelector(`[data-control="${controlMap[key]}"]`)
    ?.classList.add("active");

  recalculateFromKeys();
});

window.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();

  if (!["w", "a", "s", "d"].includes(key)) {
    return;
  }

  pressedKeys.delete(key);

  const controlMap = {
    w: "forward",
    a: "left",
    s: "reverse",
    d: "right",
  };

  // Remove the highlight from the matching on-screen button.
  document
    .querySelector(`[data-control="${controlMap[key]}"]`)
    ?.classList.remove("active");

  recalculateFromKeys();
});


// ~~~~~~~~~~~~~~~~~ Safety Behavior ~~~~~~~~~~~~~~~~~~~~~~~~~~

// Stop the vehicle if the browser window loses focus.
window.addEventListener("blur", stopVehicle);

// Stop the vehicle if the page is hidden or the user switches tabs.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopVehicle();
  }
});


// ~~~~~~~~~~~~~~~ Periodic Command Transmission ~~~~~~~~~~~~~~~

// Continuously resend the latest command.
// This keeps control responsive and ensures key releases reach the Pi.
setInterval(sendCommand, commandSendInterval);


// ~~~~~~~~~~~~~~~~ Initialization ~~~~~~~~~~~~~~~~~~~~~~~~~~~~

videoFrame.src = videoUrl;

updateDisplay();
updateSpeedIndicator();
setConnectionState(false);

log(`Video URL: ${videoUrl}`);
log(`WebSocket URL: ${websocketUrl}`);

