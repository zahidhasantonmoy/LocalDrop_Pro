import { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import notificationService from './NotificationService';

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
    const [chatHistory, setChatHistory] = useState({}); // peerId -> array of { text, sender, timestamp }
    const [fileQueue, setFileQueue] = useState({}); // peerId -> array of File objects
    const [peerProfiles, setPeerProfiles] = useState(() => {
        // Load saved peer profiles (custom names, etc.)
        const saved = localStorage.getItem('localdrop_peer_profiles');
        return saved ? JSON.parse(saved) : {};
    });

    const peerRef = useRef(null);
    const chunksRef = useRef({}); // peerId -> array of chunks
    const incomingMetaRef = useRef({}); // peerId -> metadata
    const activeTransfersRef = useRef({}); // peerId -> { active: bool, paused: bool, offset: number, file: File (sender only) }
    const lastChunkTimeRef = useRef({}); // peerId -> timestamp
    const queueRef = useRef({}); // peerId -> array of File objects (Ref for immediate access)
    const peerProfilesRef = useRef(peerProfiles); // Keep current profiles in ref for closures

    // Persistence: Save ID
    useEffect(() => {
        if (myPeerId) {
            localStorage.setItem('localdrop_peer_id', myPeerId);
        }
    }, [myPeerId]);

    // Persistence: Auto-reconnect to known peers
    useEffect(() => {
        const savedPeers = JSON.parse(localStorage.getItem('localdrop_known_peers') || '[]');

        // Wait a bit for PeerJS to stabilize before reconnecting
        const timer = setTimeout(() => {
            if (peerRef.current && !peerRef.current.destroyed) {
                savedPeers.forEach(targetId => {
                    if (targetId !== myPeerId && !connections[targetId]) {
                        console.log('Auto-reconnecting to:', targetId);
                        connectToPeer(targetId);
                    }
                });
            }
        }, 1000);

        return () => clearTimeout(timer);
    }, [myPeerId]); // Retry when myPeerId is set/ready

    useEffect(() => {
        // Initialize PeerJS
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

    // Persist peer profiles
    useEffect(() => {
        peerProfilesRef.current = peerProfiles; // Keep ref in sync
        localStorage.setItem('localdrop_peer_profiles', JSON.stringify(peerProfiles));
    }, [peerProfiles]);

    const connectToPeer = (targetPeerId) => {
        if (!peerRef.current) {
            console.warn('Cannot connect: PeerJS not initialized');
            return;
        }
        if (targetPeerId === myPeerId) {
            console.warn('Cannot connect to self');
            return;
        }
        if (peerRef.current.destroyed) {
            console.warn('Cannot connect: Peer destroyed');
            return;
        }

        // Check if already connected
        if (connections[targetPeerId]) {
            console.log('Already connected to:', targetPeerId);
            return;
        }

        console.log('Initiating connection to:', targetPeerId);
        try {
            const conn = peerRef.current.connect(targetPeerId, {
                reliable: true
            });

            if (!conn) {
                console.error('PeerJS connect returned null');
                return;
            }

            setupConnection(conn);
        } catch (e) {
            console.error('Connection failed:', e);
        }
    };

    const setupConnection = (conn) => {
        conn.on('open', () => {
            console.log('Connection opened:', conn.peer);
            setConnections(prev => ({ ...prev, [conn.peer]: conn }));
            conn.send({ type: 'user-info', user: myUserData });

            // Initialize chat history if empty
            setChatHistory(prev => {
                if (!prev[conn.peer]) return { ...prev, [conn.peer]: [] };
                return prev;
            });

            // Notify connection
            try {
                const peerName = peerProfilesRef.current[conn.peer]?.name || `Peer ${conn.peer}`;
                notificationService.notifyConnection(peerName);
            } catch (e) {
                console.warn('Notification failed:', e);
            }
        });

        conn.on('data', (data) => {
            handleData(conn.peer, data);
        });

        conn.on('close', () => {
            console.log('Connection closed:', conn.peer);
            try {
                const peerName = peerProfilesRef.current[conn.peer]?.name || `Peer ${conn.peer}`;
                notificationService.notifyDisconnection(peerName);
            } catch (e) {
                console.warn('Notification failed:', e);
            }

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
            console.log('Received control message:', data);
            if (data.action === 'cancel') {
                if (activeTransfersRef.current[peerId]) {
                    activeTransfersRef.current[peerId].active = false;
                }
                setTransfers(prev => ({
                    ...prev,
                    [peerId]: { ...prev[peerId], status: 'cancelled', speed: 0 }
                }));
                processQueue(peerId); // Try next file
            } else if (data.action === 'pause') {
                if (activeTransfersRef.current[peerId]) {
                    activeTransfersRef.current[peerId].paused = true;
                }
                setTransfers(prev => ({
                    ...prev,
                    [peerId]: { ...prev[peerId], status: 'paused', speed: 0 }
                }));
            } else if (data.action === 'resume') {
                if (activeTransfersRef.current[peerId] && activeTransfersRef.current[peerId].file) {
                    activeTransfersRef.current[peerId].paused = false;
                    activeTransfersRef.current[peerId].active = true;
                    sendChunkLoop(peerId, activeTransfersRef.current[peerId].file, data.offset);

                    setTransfers(prev => ({
                        ...prev,
                        [peerId]: { ...prev[peerId], status: 'in-progress' }
                    }));
                }
            }
            return;
        }

        // Handle User Info
        if (data && data.type === 'user-info') {
            setPeerProfiles(prev => ({
                ...prev,
                [peerId]: {
                    ...prev[peerId],
                    name: data.user?.name || `Peer ${peerId}`,
                    lastSeen: Date.now()
                }
            }));
            return;
        }

        // Handle Chat
        if (data && data.type === 'chat') {
            setChatHistory(prev => ({
                ...prev,
                [peerId]: [...(prev[peerId] || []), { text: data.text, sender: peerId, timestamp: Date.now() }]
            }));

            // Notify new message
            try {
                const peerName = peerProfilesRef.current[peerId]?.name || `Peer ${peerId}`;
                notificationService.notifyMessage(peerName, data.text);
            } catch (e) {
                console.warn('Notification failed:', e);
            }
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
                    received: meta.size
                }
            }));

            // Notify transfer complete
            notificationService.notifyTransferComplete(meta.name, 'receive');

            chunksRef.current[peerId] = [];
            activeTransfersRef.current[peerId] = null;

        } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
            if (!activeTransfersRef.current[peerId]?.active || activeTransfersRef.current[peerId]?.paused) return;

            if (!chunksRef.current[peerId]) chunksRef.current[peerId] = [];
            chunksRef.current[peerId].push(data);

            const currentRef = activeTransfersRef.current[peerId];
            currentRef.offset += data.byteLength;

            const now = Date.now();
            const timeDiff = now - lastChunkTimeRef.current[peerId];
            if (timeDiff > 1000) {
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

    const sendFiles = (peerId, files) => {
        const conn = connections[peerId];
        if (!conn) return;

        // Add to queue
        const newQueue = [...(queueRef.current[peerId] || []), ...files];
        queueRef.current[peerId] = newQueue;
        setFileQueue(prev => ({ ...prev, [peerId]: newQueue }));

        // If no active transfer, start processing
        if (!activeTransfersRef.current[peerId] || !activeTransfersRef.current[peerId].active) {
            processQueue(peerId);
        }
    };

    const processQueue = (peerId) => {
        const queue = queueRef.current[peerId];
        if (queue && queue.length > 0) {
            const file = queue[0];
            // Remove from queue
            const remaining = queue.slice(1);
            queueRef.current[peerId] = remaining;
            setFileQueue(prev => ({ ...prev, [peerId]: remaining }));

            // Start transfer
            startFileTransfer(peerId, file);
        }
    };

    const startFileTransfer = (peerId, file) => {
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
            if (!state || !state.active) return;
            if (state.paused) return;

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
                setTimeout(readSlice, 5);
            } else {
                conn.send({ type: 'file-end' });
                setTransfers(prev => ({
                    ...prev,
                    [peerId]: { ...prev[peerId], status: 'completed', speed: 0 }
                }));

                // Notify transfer complete
                notificationService.notifyTransferComplete(file.name, 'send');

                activeTransfersRef.current[peerId] = null;

                // Process next file in queue
                processQueue(peerId);
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

        // If cancelled, should we continue queue? 
        // Usually yes, but let's pause queue or just continue. 
        // For now, let's continue.
        processQueue(peerId);
    };

    const pauseTransfer = (peerId) => {
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
        const transfer = transfers[peerId];
        const conn = connections[peerId];

        if (transfer.type === 'send') {
            if (activeTransfersRef.current[peerId]) {
                activeTransfersRef.current[peerId].paused = false;
                activeTransfersRef.current[peerId].active = true;
                sendChunkLoop(peerId, activeTransfersRef.current[peerId].file, activeTransfersRef.current[peerId].offset);
            }
        } else {
            if (conn) {
                conn.send({ type: 'control', action: 'resume', offset: transfer.received });
            }
        }

        setTransfers(prev => ({
            ...prev,
            [peerId]: { ...prev[peerId], status: 'in-progress' }
        }));
    };

    const sendChatMessage = (peerId, text) => {
        const conn = connections[peerId];
        if (conn) {
            conn.send({ type: 'chat', text });
            setChatHistory(prev => ({
                ...prev,
                [peerId]: [...(prev[peerId] || []), { text, sender: 'me', timestamp: Date.now() }]
            }));
        }
    };

    const updatePeerName = (peerId, name) => {
        setPeerProfiles(prev => ({
            ...prev,
            [peerId]: {
                ...prev[peerId],
                name,
                lastSeen: Date.now()
            }
        }));
    };

    return {
        myPeerId,
        connections,
        connectToPeer,
        sendFiles,
        transfers,
        cancelTransfer,
        pauseTransfer,
        resumeTransfer,
        sendChatMessage,
        chatHistory,
        fileQueue,
        peerProfiles,
        updatePeerName,
        notificationService
    };
};
