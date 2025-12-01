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
        origin: "*", // Allow all origins for local dev
        methods: ["GET", "POST"]
    }
});

// Map to store connected users: socketId -> userData
const users = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Get client IP to group users (simplified for local dev, can be expanded)
    // For local network, we can just use a default room or group by subnet if needed.
    // Here we'll use a single 'lan' room for simplicity as requested for local drop.
    const room = 'lan-party';

    socket.join(room);

    // Handle user joining
    socket.on('join', (userData) => {
        users[socket.id] = { ...userData, id: socket.id };

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
            const room = 'lan-party'; // Should track which room user was in
            socket.to(room).emit('user-left', socket.id);
            delete users[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Signaling server running on port ${PORT}`);
});
