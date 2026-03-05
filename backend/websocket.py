"""
WebSocket endpoint — broadcasts real-time attendance events to all connected clients.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import List
import json
import asyncio

router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, message: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    @property
    def connection_count(self):
        return len(self.active)


manager = ConnectionManager()


@router.websocket("/attendance")
async def attendance_ws(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        await websocket.send_text(json.dumps({
            "type": "connected",
            "message": "Kết nối WebSocket thành công",
            "connections": manager.connection_count,
        }))
        while True:
            # Keep-alive: wait for any client message (ping)
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        manager.disconnect(websocket)


async def notify_attendance(event: dict):
    """Call this from attendance route after a check-in/check-out."""
    await manager.broadcast({"type": "attendance", **event})
