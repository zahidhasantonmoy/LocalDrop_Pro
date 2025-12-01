import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Allow all origins (including Vercel)
        methods: ["GET", "POST"]
    }
});

// Map to store connected users: socketId -> userData
const users = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle user joining
    socket.on('join', ({ userData, roomId }) => {
        const room = roomId || 'default';
        socket.join(room);

        // Store user with room info
        users[socket.id] = { ...userData, id: socket.id, room };

        // Broadcast to others in the room
        socket.to(room).emit('user-joined', users[socket.id]);

        // Send list of existing users in the room to the new user
        const roomSockets = io.sockets.adapter.rooms.get(room);
        const existingUsers = [];
        if (roomSockets) {
            for (const id of roomSockets) {
                if (id !== socket.id && users[id]) {
                    existingUsers.push(users[id]);
                }
            }
        }
        socket.emit('users-list', existingUsers);
    });

    // Handle WebRTC signaling
    socket.on('signal', (data) => {
        const { to, signal } = data;
        io.to(to).emit('signal', {
            from: socket.id,
            signal
        });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (users[socket.id]) {
            const { room } = users[socket.id];
            socket.to(room).emit('user-left', socket.id);
            delete users[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Signaling server running on port ${PORT}`);
});
