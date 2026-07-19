import asyncio
import json
import math
import time
from pathlib import Path

from websockets.asyncio.server import serve


#  ~~~~~~~~~~~~~~~ PWM Configuration ~~~~~~~~~~~~~~~~~

PWM_CHIP = Path("/sys/class/pwm/pwmchip0")

STEERING_CHANNEL = 0  # GPIO12, physical pin 32
THROTTLE_CHANNEL = 1  # GPIO13, physical pin 33

# Standard RC control period: 20 milliseconds, or 50 Hz.
PWM_PERIOD_NS = 20_000_000

STEERING_MIN_US = 1000
STEERING_CENTER_US = 1500
STEERING_MAX_US = 2000

# Conservative initial ESC range.
THROTTLE_REVERSE_US = 1100
THROTTLE_NEUTRAL_US = 1500
THROTTLE_FORWARD_US = 1900

COMMAND_TIMEOUT_SECONDS = 0.25
WATCHDOG_INTERVAL_SECONDS = 0.05


#  ~~~~~~~~~~~~~~~ Server State ~~~~~~~~~~~~~~~~~

last_command_time = time.monotonic()
failsafe_active = False


#  ~~~~~~~~~~~~~~~ Hardware PWM Interface ~~~~~~~~~~~~~~~~~

class HardwarePWM:
    """
    Control one Linux hardware-PWM channel through the sysfs interface.
    """

    def __init__(self, chip_path, channel, period_ns):
        self.chip_path = Path(chip_path)
        self.channel = channel
        self.period_ns = period_ns
        self.channel_path = self.chip_path / f"pwm{channel}"

    @staticmethod
    def _write(path, value):
        """
        Write a numeric value to a PWM sysfs control file.
        """

        Path(path).write_text(str(value), encoding="ascii")

    def export(self):
        """
        Make the PWM channel available through sysfs.
        """

        if not self.channel_path.exists():
            try:
                self._write(
                    self.chip_path / "export",
                    self.channel,
                )
            except OSError:
                # Another process may have exported it between the existence
                # check and the write operation.
                if not self.channel_path.exists():
                    raise

            # Allow the kernel time to create the pwmN directory.
            for _ in range(100):
                if self.channel_path.exists():
                    break

                time.sleep(0.01)
            else:
                raise RuntimeError(
                    f"PWM channel {self.channel} was not created"
                )

        self.disable()

        self._write(
            self.channel_path / "period",
            self.period_ns,
        )

    def set_pulsewidth_us(self, pulsewidth_us):
        """
        Set the active pulse width in microseconds.
        """

        duty_cycle_ns = int(pulsewidth_us * 1000)

        if duty_cycle_ns < 0:
            raise ValueError("Pulse width cannot be negative")

        if duty_cycle_ns > self.period_ns:
            raise ValueError(
                "Pulse width cannot exceed the PWM period"
            )

        self._write(
            self.channel_path / "duty_cycle",
            duty_cycle_ns,
        )

    def enable(self):
        """
        Enable PWM output on this channel.
        """

        self._write(self.channel_path / "enable", 1)

    def disable(self):
        """
        Disable PWM output if it is currently enabled.
        """

        enable_path = self.channel_path / "enable"

        if enable_path.exists():
            try:
                self._write(enable_path, 0)
            except OSError:
                pass


steering_pwm = HardwarePWM(
    PWM_CHIP,
    STEERING_CHANNEL,
    PWM_PERIOD_NS,
)

throttle_pwm = HardwarePWM(
    PWM_CHIP,
    THROTTLE_CHANNEL,
    PWM_PERIOD_NS,
)


#  ~~~~~~~~~~~~~~~ Control Conversion ~~~~~~~~~~~~~~~~~

def interpolate(value, input_min, input_max, output_min, output_max):
    """
    Linearly convert a value from one range to another.
    """

    input_range = input_max - input_min
    output_range = output_max - output_min

    return output_min + (
        (value - input_min)
        * output_range
        / input_range
    )


def steering_to_pulsewidth(steering):
    """
    Convert normalized steering to an RC pulse width.
    """

    pulsewidth = interpolate(
        steering,
        -1.0,
        1.0,
        STEERING_MIN_US,
        STEERING_MAX_US,
    )

    return int(round(pulsewidth))


def throttle_to_pulsewidth(throttle):
    """
    Convert normalized throttle to an RC pulse width.
    """

    if throttle >= 0.0:
        pulsewidth = interpolate(
            throttle,
            0.0,
            1.0,
            THROTTLE_NEUTRAL_US,
            THROTTLE_FORWARD_US,
        )
    else:
        pulsewidth = interpolate(
            throttle,
            -1.0,
            0.0,
            THROTTLE_REVERSE_US,
            THROTTLE_NEUTRAL_US,
        )

    return int(round(pulsewidth))


#  ~~~~~~~~~~~~~~~ Vehicle Output ~~~~~~~~~~~~~~~~~

def apply_control(steering, throttle):
    """
    Apply steering and throttle commands to the hardware PWM channels.
    """

    steering_pulse = steering_to_pulsewidth(steering)
    throttle_pulse = throttle_to_pulsewidth(throttle)

    steering_pwm.set_pulsewidth_us(steering_pulse)
    throttle_pwm.set_pulsewidth_us(throttle_pulse)

    return steering_pulse, throttle_pulse


def apply_neutral():
    """
    Center steering and command neutral throttle.
    """

    steering_pwm.set_pulsewidth_us(STEERING_CENTER_US)
    throttle_pwm.set_pulsewidth_us(THROTTLE_NEUTRAL_US)


def initialize_pwm():
    """
    Export, configure, and enable both hardware PWM channels.
    """

    steering_pwm.export()
    throttle_pwm.export()

    # Set safe values before enabling the outputs.
    apply_neutral()

    steering_pwm.enable()
    throttle_pwm.enable()


def disable_pwm():
    """
    Disable both PWM outputs.
    """

    steering_pwm.disable()
    throttle_pwm.disable()


#  ~~~~~~~~~~~~~~~ Safety Watchdog ~~~~~~~~~~~~~~~~~

async def command_watchdog():
    """
    Apply neutral controls when command messages stop arriving.
    """

    global failsafe_active

    while True:
        await asyncio.sleep(WATCHDOG_INTERVAL_SECONDS)

        command_age = time.monotonic() - last_command_time

        if (
            command_age > COMMAND_TIMEOUT_SECONDS
            and not failsafe_active
        ):
            apply_neutral()
            failsafe_active = True

            print(
                "Command timeout: throttle set to neutral "
                "and steering centered"
            )


#  ~~~~~~~~~~~~~~~ Connection Handling ~~~~~~~~~~~~~~~~~

async def handle_client(websocket):
    """
    Process control commands from a connected WebSocket client.
    """

    global last_command_time
    global failsafe_active

    print("Controller connected")
    apply_neutral()

    try:
        async for message in websocket:
            try:
                command = json.loads(message)

                if not isinstance(command, dict):
                    raise ValueError(
                        "Command must be a JSON object"
                    )

                if (
                    "steering" not in command
                    or "throttle" not in command
                ):
                    raise ValueError(
                        "Command must include steering and throttle"
                    )

                steering = float(command["steering"])
                throttle = float(command["throttle"])

                if not (
                    math.isfinite(steering)
                    and math.isfinite(throttle)
                ):
                    raise ValueError(
                        "Steering and throttle must be finite numbers"
                    )

                steering = max(-1.0, min(1.0, steering))
                throttle = max(-1.0, min(1.0, throttle))

                steering_pulse, throttle_pulse = apply_control(
                    steering,
                    throttle,
                )

                last_command_time = time.monotonic()
                failsafe_active = False

                print(
                    f"Steering: {steering:+.2f} "
                    f"({steering_pulse} us), "
                    f"Throttle: {throttle:+.2f} "
                    f"({throttle_pulse} us)"
                )

                await websocket.send(
                    json.dumps(
                        {
                            "accepted": True,
                            "steering": steering,
                            "throttle": throttle,
                            "steering_pulse_us": steering_pulse,
                            "throttle_pulse_us": throttle_pulse,
                        }
                    )
                )

            except (
                ValueError,
                TypeError,
                OverflowError,
                json.JSONDecodeError,
            ) as error:
                await websocket.send(
                    json.dumps(
                        {
                            "accepted": False,
                            "error": str(error),
                        }
                    )
                )

    finally:
        apply_neutral()
        failsafe_active = True

        print(
            "Controller disconnected; controls set to neutral"
        )


#  ~~~~~~~~~~~~~~~ Server Lifecycle ~~~~~~~~~~~~~~~~~

async def main():
    """
    Initialize PWM and run the WebSocket control server.
    """

    print("Initializing hardware PWM")

    initialize_pwm()

    # Give the ESC time to recognize the neutral signal.
    await asyncio.sleep(2.0)

    watchdog_task = asyncio.create_task(command_watchdog())

    try:
        async with serve(handle_client, "0.0.0.0", 8765):
            print("Control server listening on port 8765")
            print("Steering: GPIO12 / PWM channel 0")
            print("Throttle: GPIO13 / PWM channel 1")

            await asyncio.Future()

    finally:
        watchdog_task.cancel()
        apply_neutral()

        await asyncio.sleep(0.2)

        disable_pwm()

        print("PWM outputs disabled")


#  ~~~~~~~~~~~~~~~ Application Entry Point ~~~~~~~~~~~~~~~~~

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nControl server stopped")
