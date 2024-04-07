import asyncio
import websockets
import json
import datetime
import sys
from websockets.exceptions import ConnectionClosedError

# Dictionary to store connections with their IDs
connections = {}
ip = sys.argv[1] if len(sys.argv) > 1 else "0.0.0.0"
port = sys.argv[2] if len(sys.argv) > 2 else "6789"

async def register_client(websocket, client_id):
    connections[client_id] = websocket
    print(f"> Client {client_id} registered at {datetime.datetime.now()}")
    
async def unregister_client(client_id):
    connections.pop(client_id, None)
    print(f"> Client {client_id} unregistered at {datetime.datetime.now()}")

async def relay_message(client_id, message):
    target_websocket = connections.get(client_id)
    if target_websocket:
        await target_websocket.send(message)
        print(f"> Message relayed to Client {client_id} at {datetime.datetime.now()}")
    else:
        print(f"> Client {client_id} not found at {datetime.datetime.now()}")

async def handler(websocket, path):
    client_id = None
    try:
        async for message in websocket:
            data = json.loads(message)
            if data['type'] == 'register':
                # Client sends a register message with their ID upon connection
                client_id = data['id']
                await register_client(websocket, client_id)
            elif client_id and 'to' in data:
                # Relay message to the intended recipient based on the 'to' field
                await relay_message(data['to'], message)
    finally:
        if client_id:
            try:
                await unregister_client(client_id)
            except ConnectionClosedError:
                print(f"> Connection closed unexpectedly for Client {client_id}")

# Start the WebSocket server
start_server = websockets.serve(handler, ip, port)

print(f"> Server started at: {datetime.datetime.now()} on ws://{ip}:{port}")

# Run the server indefinitely
asyncio.get_event_loop().run_until_complete(start_server)
asyncio.get_event_loop().run_forever()
