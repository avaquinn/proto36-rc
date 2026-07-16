import asyncio
import json
import time

from websockets.asyncio.server import serve


last_command_time = time.monotonic()


async def handle_client(websocket):
    global last_command_time

    print("Controller connected")

    try:
        async for message in websocket:
            try:
                command = json.loads(message)

                if not isinstance(command, dict):
                    raise ValueError("Command must be a JSON object")

                if "steering" not in command or "throttle" not in command:
                    raise ValueError(
                        "Command must include steering and throttle"
                    )

                steering = float(command["steering"])
                throttle = float(command["throttle"])

                # Restrict both values to -1.0 through 1.0.
                steering = max(-1.0, min(1.0, steering))
                throttle = max(-1.0, min(1.0, throttle))

                last_command_time = time.monotonic()

                print(
                    f"Steering: {steering:+.2f}, "
                    f"Throttle: {throttle:+.2f}"
                )

                await websocket.send(
                    json.dumps(
                        {
                            "accepted": True,
                            "steering": steering,
                            "throttle": throttle,
                        }
                    )
                )

            except (ValueError, TypeError, json.JSONDecodeError) as error:
                await websocket.send(
                    json.dumps(
                        {
                            "accepted": False,
                            "error": str(error),
                        }
                    )
                )

    finally:
        print("Controller disconnected")


async def main():
    async with serve(handle_client, "0.0.0.0", 8765):
        print("Control server listening on port 8765")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
