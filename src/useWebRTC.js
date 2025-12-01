import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';

const CHUNK_SIZE = 64 * 1024; // 64KB

export const useWebRTC = (myUserData) => {
    const [peers, setPeers] = useState({}); // socketId -> { peer, connected }
    const [users, setUsers] = useState([]); // List of all users in room
    const [transfers, setTransfers] = useState({}); // peerId -> { type: 'send'|'receive', fileName, progress, speed, id }

    const socketRef = useRef();
    const peersRef = useRef({}); // socketId -> peer instance
    const chunksRef = useRef({}); // peerId -> array of chunks
    const incomingMetaRef = useRef({}); // peerId -> metadata

    useEffect(() => {
        // Connect to signaling server
        // For Vercel, we use the same origin but point to the API route
        const isVercel = import.meta.env.PROD;
        const url = isVercel ? window.location.origin : (import.meta.env.VITE_SIGNALING_URL || '/');
        const path = isVercel ? '/api/socket' : '/socket.io';

        socketRef.current = io(url, {
            path: path,
            addTrailingSlash: false,
            secure: true,
            rejectUnauthorized: false
        });

        socketRef.current.on('connect', () => {
            console.log('Connected to signaling server');
            // Wait for explicit join call
        });

        socketRef.current.on('users-list', (existingUsers) => {
            setUsers(existingUsers);
            // Initiate connections to all existing users
            existingUsers.forEach(user => {
                createPeer(user.id, socketRef.current.id, true);
            });
        });

        socketRef.current.on('user-joined', (newUser) => {
            setUsers(prev => {
                if (prev.find(u => u.id === newUser.id)) return prev;
                return [...prev, newUser];
            });
        });

        socketRef.current.on('user-left', (id) => {
            setUsers(prev => prev.filter(u => u.id !== id));
            if (peersRef.current[id]) {
                peersRef.current[id].destroy();
                delete peersRef.current[id];
            }
            setPeers(prev => {
                const newPeers = { ...prev };
                delete newPeers[id];
                return newPeers;
            });
        });

        socketRef.current.on('signal', (data) => {
            const { from, signal } = data;
            if (peersRef.current[from]) {
                peersRef.current[from].signal(signal);
            } else {
                const peer = createPeer(from, socketRef.current.id, false);
                peer.signal(signal);
            }
        });

        return () => {
            socketRef.current.disconnect();
            Object.values(peersRef.current).forEach(peer => peer.destroy());
        };
    }, []);

    const createPeer = (targetId, myId, initiator) => {
        const peer = new SimplePeer({
            initiator,
            trickle: false
        });

        peer.on('signal', (signal) => {
            socketRef.current.emit('signal', {
                to: targetId,
                signal
            });
        });

        peer.on('connect', () => {
            console.log('Peer connected:', targetId);
            setPeers(prev => ({ ...prev, [targetId]: { connected: true } }));
        });

        peer.on('data', (data) => {
            handleData(targetId, data);
        });

        peer.on('error', (err) => {
            console.error('Peer error:', err);
        });

        peer.on('close', () => {
            console.log('Peer closed:', targetId);
            setPeers(prev => {
                const newPeers = { ...prev };
                delete newPeers[targetId];
                return newPeers;
            });
        });

        peersRef.current[targetId] = peer;
        setPeers(prev => ({ ...prev, [targetId]: { connected: false } }));
        return peer;
    };

    const handleData = (peerId, data) => {
        // Check if data is JSON (metadata) or binary (chunk)
        // Simple way: try to parse as string if it looks like JSON
        let message;
        try {
            const text = new TextDecoder().decode(data);
            if (text.startsWith('{')) {
                message = JSON.parse(text);
            }
        } catch (e) {
            // Not JSON, likely binary
        }

        if (message && message.type === 'file-start') {
            chunksRef.current[peerId] = [];
            incomingMetaRef.current[peerId] = message;
            setTransfers(prev => ({
                ...prev,
                [peerId]: {
                    type: 'receive',
                    fileName: message.name,
                    size: message.size,
                    received: 0,
                    startTime: Date.now()
                }
            }));
        } else if (message && message.type === 'file-end') {
            const meta = incomingMetaRef.current[peerId];
            const blob = new Blob(chunksRef.current[peerId], { type: meta.mimeType });
            const url = URL.createObjectURL(blob);

            // Auto download
            const a = document.createElement('a');
            a.href = url;
            a.download = meta.name;
            a.click();

            chunksRef.current[peerId] = [];
            setTransfers(prev => {
                const newTransfers = { ...prev };
                delete newTransfers[peerId];
                return newTransfers;
            });
        } else {
            // Binary chunk
            if (!chunksRef.current[peerId]) chunksRef.current[peerId] = [];
            chunksRef.current[peerId].push(data);

            setTransfers(prev => {
                const current = prev[peerId];
                if (!current) return prev;
                return {
                    ...prev,
                    [peerId]: { ...current, received: current.received + data.byteLength }
                };
            });
        }
    };

    const sendFile = (peerId, file) => {
        const peer = peersRef.current[peerId];
        if (!peer) return;

        setTransfers(prev => ({
            ...prev,
            [peerId]: {
                type: 'send',
                fileName: file.name,
                size: file.size,
                sent: 0,
                startTime: Date.now()
            }
        }));

        // Send metadata
        peer.send(JSON.stringify({
            type: 'file-start',
            name: file.name,
            size: file.size,
            mimeType: file.type
        }));

        const reader = new FileReader();
        let offset = 0;

        const readSlice = () => {
            const slice = file.slice(offset, offset + CHUNK_SIZE);
            reader.readAsArrayBuffer(slice);
        };

        reader.onload = (e) => {
            if (peer.destroyed) return;
            peer.send(e.target.result);
            offset += CHUNK_SIZE;

            setTransfers(prev => {
                const current = prev[peerId];
                if (!current) return prev;
                return {
                    ...prev,
                    [peerId]: { ...current, sent: Math.min(offset, file.size) }
                };
            });

            if (offset < file.size) {
                // Small delay to prevent blocking UI
                setTimeout(readSlice, 0);
            } else {
                peer.send(JSON.stringify({ type: 'file-end' }));
                setTransfers(prev => {
                    const newTransfers = { ...prev };
                    delete newTransfers[peerId];
                    return newTransfers;
                });
            }
        };

        readSlice();
    };

    const joinRoom = (roomId) => {
        if (socketRef.current && socketRef.current.connected) {
            socketRef.current.emit('join', { userData: myUserData, roomId });
        }
    };

    return { users, peers, sendFile, transfers, joinRoom };
};
