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

    const peerRef = useRef(null);
    const chunksRef = useRef({}); // peerId -> array of chunks
    const incomingMetaRef = useRef({}); // peerId -> metadata
    const activeTransfersRef = useRef({}); // peerId -> boolean (true if active)

    useEffect(() => {
        // Initialize PeerJS with a custom 6-digit ID
        // Note: PeerJS Cloud might have collisions, so we retry if taken
        // But for this demo we'll just try once with a random ID
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
            // If ID is taken, we could retry here, but for now just log
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
                [peerId]: { ...prev[peerId], status: 'cancelled' }
            }));
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

            setTransfers(prev => ({
                ...prev,
                [peerId]: {
                    type: 'receive',
                    fileName: data.name,
                    size: data.size,
                    received: 0,
                    startTime: Date.now(),
                    status: 'in-progress'
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
                    blobUrl: url
                }
            }));

            chunksRef.current[peerId] = [];
            activeTransfersRef.current[peerId] = false;

        } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
            if (!activeTransfersRef.current[peerId]) return; // Was cancelled

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
                status: 'in-progress'
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
                return {
                    ...prev,
                    [peerId]: { ...current, sent: Math.min(offset, file.size) }
                };
            });

            if (offset < file.size) {
                setTimeout(readSlice, 10);
            } else {
                conn.send({ type: 'file-end' });
                setTransfers(prev => ({
                    ...prev,
                    [peerId]: { ...prev[peerId], status: 'completed' }
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
            [peerId]: { ...prev[peerId], status: 'cancelled' }
        }));
    };

    return { myPeerId, connections, connectToPeer, sendFile, transfers, cancelTransfer };
};
