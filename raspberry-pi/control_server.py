import asyncio
import json
import time

from websockets.asyncio.server import serve


#  ~~~~~~~~~~~~~~~ Server State ~~~~~~~~~~~~~~~~~

# Timestamp of the most recently accepted control command.
# This can support a future command-timeout safety mechanism.
last_command_time = time.monotonic()


#  ~~~~~~~~~~~~~~~ Connection Handling ~~~~~~~~~~~~~~~~~

async def handle_client(websocket):
    """
    Process control commands from a connected WebSocket client.
    """

    global last_command_time

    print("Controller connected")

    try:
        async for message in websocket:
            try:
                command = json.loads(message)

                # Commands must be JSON objects containing both control fields.
                if not isinstance(command, dict):
                    raise ValueError("Command must be a JSON object")

                if "steering" not in command or "throttle" not in command:
                    raise ValueError(
                        "Command must include steering and throttle"
                    )

                steering = float(command["steering"])
                throttle = float(command["throttle"])

                # Constrain control values to the normalized command range.
                steering = max(-1.0, min(1.0, steering))
                throttle = max(-1.0, min(1.0, throttle))

                last_command_time = time.monotonic()

                print(
                    f"Steering: {steering:+.2f}, "
                    f"Throttle: {throttle:+.2f}"
                )

                # Return the accepted command values to the client.
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
                # Report invalid commands without terminating the connection.
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


#  ~~~~~~~~~~~~~~~ Server Lifecycle ~~~~~~~~~~~~~~~~~

async def main():
    """
    Start the control server and run until the process is terminated.
    """

    # Bind to all network interfaces on the Raspberry Pi.
    async with serve(handle_client, "0.0.0.0", 8765):
        print("Control server listening on port 8765")
        await asyncio.Future()


#  ~~~~~~~~~~~~~~~ Application Entry Point ~~~~~~~~~~~~~~~~~

if __name__ == "__main__":
    asyncio.run(main())
