import { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';

const CHUNK_SIZE = 64 * 1024; // 64KB

// Helper to generate 6-digit ID
const generateShortId = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

export const useWebRTC = (myUserData) => {
    // Persistence: Load ID from localStorage or generate new
    const [myPeerId, setMyPeerId] = useState(() => {
        return localStorage.getItem('localdrop_peer_id') || '';
    });

    const [connections, setConnections] = useState({}); // peerId -> DataConnection
    const [transfers, setTransfers] = useState({}); // peerId -> transfer info
    const [clipboardHistory, setClipboardHistory] = useState([]);

    const peerRef = useRef(null);
    const chunksRef = useRef({}); // peerId -> array of chunks
    const incomingMetaRef = useRef({}); // peerId -> metadata
    const activeTransfersRef = useRef({}); // peerId -> { active: bool, paused: bool, offset: number, file: File (sender only) }
    const lastChunkTimeRef = useRef({}); // peerId -> timestamp

    // Persistence: Save ID
    useEffect(() => {
        if (myPeerId) {
            localStorage.setItem('localdrop_peer_id', myPeerId);
        }
    }, [myPeerId]);

    // Persistence: Auto-reconnect to known peers
    useEffect(() => {
        const savedPeers = JSON.parse(localStorage.getItem('localdrop_known_peers') || '[]');
        if (peerRef.current && !peerRef.current.destroyed) {
            savedPeers.forEach(targetId => {
                if (targetId !== myPeerId && !connections[targetId]) {
                    console.log('Auto-reconnecting to:', targetId);
                    connectToPeer(targetId);
                }
            });
        }
    }, [myPeerId]); // Retry when myPeerId is set/ready

    useEffect(() => {
        // Initialize PeerJS
        // If we have a stored ID, try to use it. If taken/error, we might need to generate new.
        const startPeer = (idToUse) => {
            const id = idToUse || generateShortId();
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
                if (err.type === 'unavailable-id') {
                    // ID taken, generate new one and retry
                    console.log('ID taken, generating new one...');
                    peer.destroy();
                    startPeer(generateShortId());
                }
            });

            peerRef.current = peer;
        };

        startPeer(myPeerId);

        return () => {
            if (peerRef.current) peerRef.current.destroy();
        };
    }, []);

    // Update known peers in localStorage
    useEffect(() => {
        const peerIds = Object.keys(connections);
        if (peerIds.length > 0) {
            localStorage.setItem('localdrop_known_peers', JSON.stringify(peerIds));
        }
    }, [connections]);

    const connectToPeer = (targetPeerId) => {
        if (!peerRef.current || targetPeerId === myPeerId) return;
        // Check if already connected
        if (connections[targetPeerId]) return;

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
        // Handle Control Messages
        if (data && data.type === 'control') {
            if (data.action === 'cancel') {
                // Received cancel signal
                if (activeTransfersRef.current[peerId]) {
                    activeTransfersRef.current[peerId].active = false;
                }
                setTransfers(prev => ({
                    ...prev,
                    [peerId]: { ...prev[peerId], status: 'cancelled', speed: 0 }
                }));
            } else if (data.action === 'pause') {
                // Received pause signal
                if (activeTransfersRef.current[peerId]) {
                    activeTransfersRef.current[peerId].paused = true;
                }
                setTransfers(prev => ({
                    ...prev,
                    [peerId]: { ...prev[peerId], status: 'paused', speed: 0 }
                }));
            } else if (data.action === 'resume') {
                // Received resume signal (usually from receiver telling sender to restart from offset)
                if (activeTransfersRef.current[peerId] && activeTransfersRef.current[peerId].file) {
                    // I am sender, resume sending
                    activeTransfersRef.current[peerId].paused = false;
                    activeTransfersRef.current[peerId].active = true;
                    // Restart reading loop from requested offset
                    sendChunkLoop(peerId, activeTransfersRef.current[peerId].file, data.offset);

                    setTransfers(prev => ({
                        ...prev,
                        [peerId]: { ...prev[peerId], status: 'in-progress' }
                    }));
                }
            }
            return;
        }

        // Handle Clipboard
        if (data && data.type === 'clipboard') {
            setClipboardHistory(prev => [{ text: data.text, sender: peerId, timestamp: Date.now() }, ...prev]);
            return;
        }

        // Handle File Transfer
        if (data && data.type === 'file-start') {
            chunksRef.current[peerId] = [];
            incomingMetaRef.current[peerId] = data;
            activeTransfersRef.current[peerId] = { active: true, paused: false, offset: 0 };
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
            if (!activeTransfersRef.current[peerId]?.active) return;

            const meta = incomingMetaRef.current[peerId];
            const blob = new Blob(chunksRef.current[peerId], { type: meta.mimeType });
            const url = URL.createObjectURL(blob);

            setTransfers(prev => ({
                ...prev,
                [peerId]: {
                    ...prev[peerId],
                    status: 'completed',
                    blobUrl: url,
                    speed: 0,
                    received: meta.size // Ensure 100%
                }
            }));

            chunksRef.current[peerId] = [];
            activeTransfersRef.current[peerId] = null;

        } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
            if (!activeTransfersRef.current[peerId]?.active || activeTransfersRef.current[peerId]?.paused) return;

            // Binary chunk
            if (!chunksRef.current[peerId]) chunksRef.current[peerId] = [];
            chunksRef.current[peerId].push(data);

            const currentRef = activeTransfersRef.current[peerId];
            currentRef.offset += data.byteLength;

            // Calculate Speed
            const now = Date.now();
            const timeDiff = now - lastChunkTimeRef.current[peerId];
            if (timeDiff > 1000) { // Update speed every 1s
                lastChunkTimeRef.current[peerId] = now;
            }

            setTransfers(prev => {
                const current = prev[peerId];
                if (!current) return prev;

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

        activeTransfersRef.current[peerId] = { active: true, paused: false, offset: 0, file: file };

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

        sendChunkLoop(peerId, file, 0);
    };

    const sendChunkLoop = (peerId, file, startOffset) => {
        const conn = connections[peerId];
        let offset = startOffset;
        const reader = new FileReader();

        const readSlice = () => {
            const state = activeTransfersRef.current[peerId];
            if (!state || !state.active) {
                // Cancelled or finished
                return;
            }
            if (state.paused) {
                // Paused, stop loop
                return;
            }

            const slice = file.slice(offset, offset + CHUNK_SIZE);
            reader.readAsArrayBuffer(slice);
        };

        reader.onload = (e) => {
            const state = activeTransfersRef.current[peerId];
            if (!conn.open || !state || !state.active || state.paused) return;

            conn.send(e.target.result);
            offset += CHUNK_SIZE;
            state.offset = offset;

            setTransfers(prev => {
                const current = prev[peerId];
                if (!current) return prev;

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
                // Use setTimeout to avoid blocking UI and allow pause checks
                setTimeout(readSlice, 5);
            } else {
                conn.send({ type: 'file-end' });
                setTransfers(prev => ({
                    ...prev,
                    [peerId]: { ...prev[peerId], status: 'completed', speed: 0 }
                }));
                activeTransfersRef.current[peerId] = null;
            }
        };

        readSlice();
    };

    const cancelTransfer = (peerId) => {
        if (activeTransfersRef.current[peerId]) {
            activeTransfersRef.current[peerId].active = false;
        }
        const conn = connections[peerId];
        if (conn) {
            conn.send({ type: 'control', action: 'cancel' });
        }
        setTransfers(prev => ({
            ...prev,
            [peerId]: { ...prev[peerId], status: 'cancelled', speed: 0 }
        }));
    };

    const pauseTransfer = (peerId) => {
        // Only sender can pause effectively in this simple model, 
        // or receiver sends pause request.
        // Let's allow both to pause.
        if (activeTransfersRef.current[peerId]) {
            activeTransfersRef.current[peerId].paused = true;
        }

        const conn = connections[peerId];
        if (conn) {
            conn.send({ type: 'control', action: 'pause' });
        }

        setTransfers(prev => ({
            ...prev,
            [peerId]: { ...prev[peerId], status: 'paused', speed: 0 }
        }));
    };

    const resumeTransfer = (peerId) => {
        // If I am sender, I just resume.
        // If I am receiver, I ask sender to resume from my received amount.
        const transfer = transfers[peerId];
        const conn = connections[peerId];

        if (transfer.type === 'send') {
            if (activeTransfersRef.current[peerId]) {
                activeTransfersRef.current[peerId].paused = false;
                activeTransfersRef.current[peerId].active = true;
                // Resume loop
                sendChunkLoop(peerId, activeTransfersRef.current[peerId].file, activeTransfersRef.current[peerId].offset);
            }
        } else {
            // Receiver asking for resume
            if (conn) {
                conn.send({ type: 'control', action: 'resume', offset: transfer.received });
            }
        }

        setTransfers(prev => ({
            ...prev,
            [peerId]: { ...prev[peerId], status: 'in-progress' }
        }));
    };

    const sendClipboard = (text) => {
        Object.values(connections).forEach(conn => {
            conn.send({ type: 'clipboard', text });
        });
    };

    return {
        myPeerId,
        connections,
        connectToPeer,
        sendFile,
        transfers,
        cancelTransfer,
        pauseTransfer,
        resumeTransfer,
        sendClipboard,
        clipboardHistory
    };
};
