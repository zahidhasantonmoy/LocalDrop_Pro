import { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';

const CHUNK_SIZE = 64 * 1024; // 64KB

// Helper to generate 6-digit ID
const generateShortId = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

export const useWebRTC = (myUserData) => {
    const [myPeerId, setMyPeerId] = useState('');
    const [connections, setConnections] = useState({}); // peerId -> DataConnection
    const [transfers, setTransfers] = useState({}); // peerId -> transfer info
    const [clipboardHistory, setClipboardHistory] = useState([]); // Array of { text, sender, timestamp }

    const peerRef = useRef(null);
    const chunksRef = useRef({}); // peerId -> array of chunks
    const incomingMetaRef = useRef({}); // peerId -> metadata
    const activeTransfersRef = useRef({}); // peerId -> boolean (true if active)
    const lastChunkTimeRef = useRef({}); // peerId -> timestamp

    useEffect(() => {
        // Initialize PeerJS with a custom 6-digit ID
        const id = generateShortId();
        const peer = new Peer(id);

        peer.on('open', (id) => {
            console.log('My Peer ID is: ' + id);
            setMyPeerId(id);
        });

        peer.on('connection', (conn) => {
            console.log('Incoming connection from:', conn.peer);
            setupConnection(conn);
        });

        peer.on('error', (err) => {
            console.error('PeerJS error:', err);
        });

        peerRef.current = peer;

        return () => {
            peer.destroy();
        };
    }, []);

    const connectToPeer = (targetPeerId) => {
        if (!peerRef.current) return;
        console.log('Connecting to:', targetPeerId);
        const conn = peerRef.current.connect(targetPeerId);
        setupConnection(conn);
    };

    const setupConnection = (conn) => {
        conn.on('open', () => {
            console.log('Connection opened:', conn.peer);
            setConnections(prev => ({ ...prev, [conn.peer]: conn }));
            conn.send({ type: 'user-info', user: myUserData });
        });

        conn.on('data', (data) => {
            handleData(conn.peer, data);
        });

        conn.on('close', () => {
            console.log('Connection closed:', conn.peer);
            setConnections(prev => {
                const newConns = { ...prev };
                delete newConns[conn.peer];
                return newConns;
            });
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
        });
    };

    const handleData = (peerId, data) => {
        // Handle Control Messages (Cancel)
        if (data && data.type === 'cancel') {
            activeTransfersRef.current[peerId] = false;
            setTransfers(prev => ({
                ...prev,
                [peerId]: { ...prev[peerId], status: 'cancelled', speed: 0 }
            }));
            return;
        }

        // Handle Clipboard
        if (data && data.type === 'clipboard') {
            setClipboardHistory(prev => [{ text: data.text, sender: peerId, timestamp: Date.now() }, ...prev]);
            return;
        }

        // Handle User Info
        if (data && data.type === 'user-info') {
            // Store user info if needed
            return;
        }

        // Handle File Transfer
        if (data && data.type === 'file-start') {
            chunksRef.current[peerId] = [];
            incomingMetaRef.current[peerId] = data;
            activeTransfersRef.current[peerId] = true;
            lastChunkTimeRef.current[peerId] = Date.now();

            setTransfers(prev => ({
                ...prev,
                [peerId]: {
                    type: 'receive',
                    fileName: data.name,
                    size: data.size,
                    received: 0,
                    startTime: Date.now(),
                    status: 'in-progress',
                    speed: 0
                }
            }));
        } else if (data && data.type === 'file-end') {
            if (!activeTransfersRef.current[peerId]) return; // Was cancelled

            const meta = incomingMetaRef.current[peerId];
            const blob = new Blob(chunksRef.current[peerId], { type: meta.mimeType });
            const url = URL.createObjectURL(blob);

            // NO AUTO DOWNLOAD - Just update state
            setTransfers(prev => ({
                ...prev,
                [peerId]: {
                    ...prev[peerId],
                    status: 'completed',
                    blobUrl: url,
                    speed: 0
                }
            }));

            chunksRef.current[peerId] = [];
            activeTransfersRef.current[peerId] = false;

        } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
            if (!activeTransfersRef.current[peerId]) return; // Was cancelled

            // Binary chunk
            if (!chunksRef.current[peerId]) chunksRef.current[peerId] = [];
            chunksRef.current[peerId].push(data);

            // Calculate Speed
            const now = Date.now();
            const timeDiff = now - lastChunkTimeRef.current[peerId];
            let speed = 0;
            if (timeDiff > 500) { // Update speed every 500ms
                // This is a rough estimate, ideally we'd track bytes over time
                // For simplicity, we'll just leave it as 0 or implement a better moving average later
                // Actually, let's just not update speed on every chunk to avoid re-renders
                lastChunkTimeRef.current[peerId] = now;
            }

            setTransfers(prev => {
                const current = prev[peerId];
                if (!current) return prev;

                // Simple speed calc: bytes / (now - startTime) * 1000
                const elapsed = (now - current.startTime) / 1000;
                const newReceived = current.received + data.byteLength;
                const currentSpeed = elapsed > 0 ? newReceived / elapsed : 0;

                return {
                    ...prev,
                    [peerId]: {
                        ...current,
                        received: newReceived,
                        speed: currentSpeed
                    }
                };
            });
        }
    };

    const sendFile = (peerId, file) => {
        const conn = connections[peerId];
        if (!conn) return;

        activeTransfersRef.current[peerId] = true;
        setTransfers(prev => ({
            ...prev,
            [peerId]: {
                type: 'send',
                fileName: file.name,
                size: file.size,
                sent: 0,
                startTime: Date.now(),
                status: 'in-progress',
                speed: 0
            }
        }));

        // Send metadata
        conn.send({
            type: 'file-start',
            name: file.name,
            size: file.size,
            mimeType: file.type
        });

        const reader = new FileReader();
        let offset = 0;

        const readSlice = () => {
            if (!activeTransfersRef.current[peerId]) {
                // Cancelled
                conn.send({ type: 'cancel' });
                return;
            }

            const slice = file.slice(offset, offset + CHUNK_SIZE);
            reader.readAsArrayBuffer(slice);
        };

        reader.onload = (e) => {
            if (!conn.open || !activeTransfersRef.current[peerId]) return;

            conn.send(e.target.result);
            offset += CHUNK_SIZE;

            setTransfers(prev => {
                const current = prev[peerId];
                if (!current) return prev;

                // Calculate Speed
                const now = Date.now();
                const elapsed = (now - current.startTime) / 1000;
                const currentSpeed = elapsed > 0 ? offset / elapsed : 0;

                return {
                    ...prev,
                    [peerId]: {
                        ...current,
                        sent: Math.min(offset, file.size),
                        speed: currentSpeed
                    }
                };
            });

            if (offset < file.size) {
                setTimeout(readSlice, 10);
            } else {
                conn.send({ type: 'file-end' });
                setTransfers(prev => ({
                    ...prev,
                    [peerId]: { ...prev[peerId], status: 'completed', speed: 0 }
                }));
                activeTransfersRef.current[peerId] = false;
            }
        };

        readSlice();
    };

    const cancelTransfer = (peerId) => {
        activeTransfersRef.current[peerId] = false;
        const conn = connections[peerId];
        if (conn) {
            conn.send({ type: 'cancel' });
        }
        setTransfers(prev => ({
            ...prev,
            [peerId]: { ...prev[peerId], status: 'cancelled', speed: 0 }
        }));
    };

    const sendClipboard = (text) => {
        Object.values(connections).forEach(conn => {
            conn.send({ type: 'clipboard', text });
        });
    };

    return { myPeerId, connections, connectToPeer, sendFile, transfers, cancelTransfer, sendClipboard, clipboardHistory };
};
