import { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';

const CHUNK_SIZE = 64 * 1024; // 64KB

export const useWebRTC = (myUserData) => {
    const [myPeerId, setMyPeerId] = useState('');
    const [connections, setConnections] = useState({}); // peerId -> DataConnection
    const [transfers, setTransfers] = useState({}); // peerId -> transfer info

    const peerRef = useRef(null);
    const chunksRef = useRef({}); // peerId -> array of chunks
    const incomingMetaRef = useRef({}); // peerId -> metadata

    useEffect(() => {
        // Initialize PeerJS
        const peer = new Peer();

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

            // Send our user data immediately
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
        // Handle User Info
        if (data && data.type === 'user-info') {
            // We can store this if we want to show names instead of IDs
            // For now, we just log it
            console.log('Received user info:', data.user);
            return;
        }

        // Handle File Transfer
        if (data && data.type === 'file-start') {
            chunksRef.current[peerId] = [];
            incomingMetaRef.current[peerId] = data;
            setTransfers(prev => ({
                ...prev,
                [peerId]: {
                    type: 'receive',
                    fileName: data.name,
                    size: data.size,
                    received: 0,
                    startTime: Date.now()
                }
            }));
        } else if (data && data.type === 'file-end') {
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
        } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
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
        conn.send({
            type: 'file-start',
            name: file.name,
            size: file.size,
            mimeType: file.type
        });

        const reader = new FileReader();
        let offset = 0;

        const readSlice = () => {
            const slice = file.slice(offset, offset + CHUNK_SIZE);
            reader.readAsArrayBuffer(slice);
        };

        reader.onload = (e) => {
            if (!conn.open) return;
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
                // Small delay to prevent blocking UI and buffer overflow
                setTimeout(readSlice, 10);
            } else {
                conn.send({ type: 'file-end' });
                setTransfers(prev => {
                    const newTransfers = { ...prev };
                    delete newTransfers[peerId];
                    return newTransfers;
                });
            }
        };

        readSlice();
    };

    return { myPeerId, connections, connectToPeer, sendFile, transfers };
};
