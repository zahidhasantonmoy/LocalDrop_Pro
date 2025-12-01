import { Server } from 'socket.io';

const ioHandler = (req, res) => {
    if (!res.socket.server.io) {
        console.log('*First use, starting socket.io*');

        const io = new Server(res.socket.server, {
            path: '/api/socket',
            addTrailingSlash: false,
        });

        // Map to store connected users: socketId -> userData
        // NOTE: This is in-memory and will be lost on function restart
        const users = {};

        io.on('connection', (socket) => {
            console.log('User connected:', socket.id);

            // Handle user joining
            socket.on('join', ({ userData, roomId }) => {
                const room = roomId || 'default';
                socket.join(room);

                users[socket.id] = { ...userData, id: socket.id, room };

                socket.to(room).emit('user-joined', users[socket.id]);

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

        res.socket.server.io = io;
    } else {
        console.log('Socket.io already running');
    }
    res.end();
};

export const config = {
    api: {
        bodyParser: false,
    },
};

export default ioHandler;
