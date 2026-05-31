const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// ─── Static Files ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Room Storage ────────────────────────────────────────────────────────────
// rooms[roomId] = { white: socketId, black: socketId, fen: string, started: bool }
const rooms = {};

function generateRoomId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g. "A3F9B2"
}

// ─── Socket.io Logic ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ── Create Room ────────────────────────────────────────────────────────────
  socket.on('create_room', () => {
    let roomId;
    do { roomId = generateRoomId(); } while (rooms[roomId]);

    rooms[roomId] = {
      white: socket.id,
      black: null,
      fen: 'start',
      started: false,
      chat: []
    };

    socket.join(roomId);
    socket.roomId = roomId;
    socket.color = 'white';

    socket.emit('room_created', { roomId, color: 'white' });
    console.log(`[Room] Created: ${roomId} by ${socket.id}`);
  });

  // ── Join Room ──────────────────────────────────────────────────────────────
  socket.on('join_room', ({ roomId }) => {
    const id = roomId.trim().toUpperCase();
    const room = rooms[id];

    if (!room) {
      return socket.emit('join_error', { message: 'الغرفة غير موجودة! تحقق من الرمز.' });
    }
    if (room.black) {
      return socket.emit('join_error', { message: 'الغرفة ممتلئة! هناك لاعبان بالفعل.' });
    }

    room.black = socket.id;
    room.started = true;
    socket.join(id);
    socket.roomId = id;
    socket.color = 'black';

    // Notify the black player
    socket.emit('room_joined', { roomId: id, color: 'black', fen: room.fen });

    // Notify white that opponent arrived
    const whiteSocket = io.sockets.sockets.get(room.white);
    if (whiteSocket) {
      whiteSocket.emit('opponent_joined', { roomId: id });
    }

    // Broadcast game start to both
    io.to(id).emit('game_start', { fen: room.fen });
    console.log(`[Room] ${id} — game started`);
  });

  // ── Move ───────────────────────────────────────────────────────────────────
  socket.on('move', ({ roomId, move, fen }) => {
    const room = rooms[roomId];
    if (!room) return;

    // Validate that this socket is a player in this room
    const isWhite = room.white === socket.id;
    const isBlack = room.black === socket.id;
    if (!isWhite && !isBlack) return;

    // Update stored FEN
    room.fen = fen;

    // Relay move to opponent only
    socket.to(roomId).emit('move', { move, fen });
  });

  // ── Promotion ──────────────────────────────────────────────────────────────
  socket.on('promotion', ({ roomId, move, fen }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.fen = fen;
    socket.to(roomId).emit('promotion', { move, fen });
  });

  // ── Chat Message ───────────────────────────────────────────────────────────
  socket.on('chat_message', ({ roomId, message, color }) => {
    const room = rooms[roomId];
    if (!room) return;

    // Only players in this room can chat
    if (room.white !== socket.id && room.black !== socket.id) return;

    io.to(roomId).emit('chat_message', { message, color });
  });

  // ── Rematch Request ────────────────────────────────────────────────────────
  socket.on('rematch_request', ({ roomId }) => {
    socket.to(roomId).emit('rematch_request');
  });

  socket.on('rematch_accept', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // Swap colors
    const tmp = room.white;
    room.white = room.black;
    room.black = tmp;
    room.fen = 'start';

    // Update color on sockets
    const ws = io.sockets.sockets.get(room.white);
    const bs = io.sockets.sockets.get(room.black);
    if (ws) ws.color = 'white';
    if (bs) bs.color = 'black';

    io.to(roomId).emit('rematch_start', {
      white: room.white,
      black: room.black
    });
  });

  socket.on('rematch_decline', ({ roomId }) => {
    socket.to(roomId).emit('rematch_declined');
  });

  // ── Resign ─────────────────────────────────────────────────────────────────
  socket.on('resign', ({ roomId, color }) => {
    socket.to(roomId).emit('opponent_resigned', { color });
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    // Notify opponent
    socket.to(roomId).emit('opponent_disconnected');

    // Clean up room after 30s (allow reconnect grace period)
    setTimeout(() => {
      const room = rooms[roomId];
      if (!room) return;
      const wConnected = room.white && io.sockets.sockets.get(room.white);
      const bConnected = room.black && io.sockets.sockets.get(room.black);
      if (!wConnected && !bConnected) {
        delete rooms[roomId];
        console.log(`[Room] Deleted: ${roomId}`);
      }
    }, 30000);
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n♟  Chess Server running at http://localhost:${PORT}\n`);
});
