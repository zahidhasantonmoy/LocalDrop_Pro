import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import JSZip from 'jszip';
import { useWebRTC } from './useWebRTC';

// Generate a random user ID and name
const generateUser = () => {
    const names = ['Nebula', 'Quasar', 'Pulsar', 'Nova', 'Zenith', 'Cosmos', 'Orbit'];
    const name = names[Math.floor(Math.random() * names.length)];
    const id = Math.random().toString(36).substr(2, 9);
    return { name, id, avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${id}` };
};

const myUser = generateUser();

function App() {
    const { users, peers, sendFile, transfers, joinRoom } = useWebRTC(myUser);
    const [showQR, setShowQR] = useState(false);
    const [clipboardText, setClipboardText] = useState('');
    const [dragOver, setDragOver] = useState(null); // peerId
    const [connected, setConnected] = useState(false);
    const [roomId, setRoomId] = useState('');
    const [history, setHistory] = useState([]); // Array of transfer objects
    const fileInputRef = useRef(null);
    const [selectedPeer, setSelectedPeer] = useState(null);

    useEffect(() => {
        // Check URL for room ID
        const params = new URLSearchParams(window.location.search);
        const room = params.get('room');
        if (room) {
            setRoomId(room);
        }
    }, []);

    useEffect(() => {
        // Update history when transfers complete
        Object.entries(transfers).forEach(([peerId, transfer]) => {
            if (transfer.sent === transfer.size || transfer.received === transfer.size) {
                setHistory(prev => {
                    if (prev.find(h => h.id === transfer.startTime)) return prev;
                    return [{ ...transfer, peerId, timestamp: new Date() }, ...prev];
                });
            }
        });
    }, [transfers]);

    const handleJoin = (e) => {
        e.preventDefault();
        if (roomId) {
            joinRoom(roomId);
            setConnected(true);
        }
    };

    const handleDragOver = (e, peerId) => {
        e.preventDefault();
        if (peerId) setDragOver(peerId);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setDragOver(null);
    };

    const handleDrop = async (e, peerId) => {
        e.preventDefault();
        setDragOver(null);
        const items = e.dataTransfer.items;
        processItems(items, peerId);
    };

    const processItems = async (items, peerId) => {
        if (items) {
            for (let i = 0; i < items.length; i++) {
                const item = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : (items[i].getAsEntry ? items[i].getAsEntry() : null);
                if (item) {
                    if (item.isFile) {
                        const file = items[i].getAsFile();
                        sendFile(peerId, file);
                    } else if (item.isDirectory) {
                        // Zip directory
                        const zip = new JSZip();
                        await addDirectoryToZip(zip, item);
                        const content = await zip.generateAsync({ type: "blob" });
                        const file = new File([content], `${item.name}.zip`, { type: "application/zip" });
                        sendFile(peerId, file);
                    }
                } else if (items[i].kind === 'file') {
                    const file = items[i].getAsFile();
                    sendFile(peerId, file);
                }
            }
        }
    };

    const addDirectoryToZip = async (zip, entry) => {
        const reader = entry.createReader();
        const entries = await new Promise((resolve) => reader.readEntries(resolve));

        for (const child of entries) {
            if (child.isFile) {
                const file = await new Promise((resolve) => child.file(resolve));
                zip.file(child.name, file);
            } else if (child.isDirectory) {
                const folder = zip.folder(child.name);
                await addDirectoryToZip(folder, child);
            }
        }
    };

    const handleFileSelect = (e) => {
        if (e.target.files && selectedPeer) {
            for (let i = 0; i < e.target.files.length; i++) {
                sendFile(selectedPeer, e.target.files[i]);
            }
        }
        setSelectedPeer(null);
    };

    const openFilePicker = (peerId) => {
        setSelectedPeer(peerId);
        fileInputRef.current.click();
    };

    const localUrl = `${window.location.origin}?room=${roomId}`;

    if (!connected) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4">
                <div className="glass-panel p-8 rounded-3xl w-full max-w-md text-center">
                    <h1 className="text-3xl font-bold mb-2">LocalDrop Pro</h1>
                    <p className="text-white/50 mb-8">Enter a Room PIN to join</p>
                    <form onSubmit={handleJoin} className="flex flex-col gap-4">
                        <input
                            type="text"
                            placeholder="Room PIN (e.g. 1234)"
                            className="bg-black/20 border border-white/10 rounded-xl p-4 text-center text-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={roomId}
                            onChange={(e) => setRoomId(e.target.value)}
                            required
                        />
                        <button type="submit" className="bg-blue-600 hover:bg-blue-500 py-4 rounded-xl font-bold text-lg transition-colors">
                            Join Room
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen text-white p-8 relative font-sans">
            <input type="file" multiple ref={fileInputRef} className="hidden" onChange={handleFileSelect} />

            {/* Background Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
                <motion.div
                    animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 0] }}
                    transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                    className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-600 rounded-full mix-blend-multiply filter blur-[128px] opacity-50"
                />
                <motion.div
                    animate={{ scale: [1, 1.1, 1], rotate: [0, -60, 0] }}
                    transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                    className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-600 rounded-full mix-blend-multiply filter blur-[128px] opacity-50"
                />
            </div>

            {/* Header */}
            <header className="flex justify-between items-center mb-12 glass-panel p-4 rounded-2xl">
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <img src={myUser.avatar} alt="Me" className="w-12 h-12 rounded-full border-2 border-white/20" />
                        <motion.div
                            animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                            transition={{ duration: 2, repeat: Infinity }}
                            className="absolute inset-0 rounded-full border-2 border-blue-400"
                        />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold">{myUser.name}</h1>
                        <p className="text-xs text-white/50">Room: {roomId}</p>
                    </div>
                </div>
                <div className="flex gap-4">
                    <button
                        onClick={() => setShowQR(!showQR)}
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                    >
                        📱 Pair Mobile
                    </button>
                </div>
            </header>

            {/* Main Grid */}
            <main className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {/* Discovery Area */}
                <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {users.filter(u => u.id !== myUser.id).map(user => (
                        <motion.div
                            key={user.id}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className={`glass-panel p-6 rounded-3xl relative overflow-hidden transition-all duration-300 ${dragOver === user.id ? 'ring-4 ring-blue-500 bg-white/10' : ''}`}
                            onDragOver={(e) => handleDragOver(e, user.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, user.id)}
                        >
                            <div className="flex flex-col items-center gap-4 z-10 relative">
                                <div className="relative">
                                    <img src={user.avatar} alt={user.name} className="w-24 h-24 rounded-full bg-black/20" />
                                    {peers[user.id]?.connected && (
                                        <div className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 rounded-full border-2 border-black" />
                                    )}
                                </div>
                                <h2 className="text-2xl font-bold">{user.name}</h2>
                                <p className="text-sm text-white/50">{peers[user.id]?.connected ? 'Connected' : 'Connecting...'}</p>

                                {/* Explicit Send Button */}
                                <button
                                    onClick={() => openFilePicker(user.id)}
                                    className="mt-2 px-6 py-2 bg-white/10 hover:bg-white/20 rounded-full text-sm font-medium transition-colors"
                                >
                                    Send File
                                </button>

                                {/* Transfer Progress */}
                                {transfers[user.id] && (
                                    <div className="w-full mt-4 bg-black/20 rounded-full h-2 overflow-hidden relative">
                                        <motion.div
                                            className="absolute top-0 left-0 h-full bg-blue-500"
                                            initial={{ width: 0 }}
                                            animate={{ width: `${(transfers[user.id].type === 'send' ? transfers[user.id].sent : transfers[user.id].received) / transfers[user.id].size * 100}%` }}
                                        />
                                        <p className="text-xs text-center mt-2">
                                            {transfers[user.id].type === 'send' ? 'Sending' : 'Receiving'} {transfers[user.id].fileName}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ))}

                    {users.length <= 1 && (
                        <div className="col-span-full flex flex-col items-center justify-center p-12 text-white/30">
                            <div className="w-16 h-16 border-4 border-white/10 border-t-blue-500 rounded-full animate-spin mb-4" />
                            <p>Waiting for peers in Room {roomId}...</p>
                        </div>
                    )}
                </div>

                {/* Sidebar */}
                <div className="flex flex-col gap-6">
                    {/* QR Code */}
                    <AnimatePresence>
                        {showQR && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 20 }}
                                className="glass-panel p-6 rounded-3xl flex flex-col items-center"
                            >
                                <h3 className="mb-4 font-bold">Scan to Connect</h3>
                                <div className="bg-white p-4 rounded-xl">
                                    <QRCodeSVG value={localUrl} size={200} />
                                </div>
                                <p className="mt-4 text-xs text-center break-all text-white/50">{localUrl}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Universal Clipboard */}
                    <div className="glass-panel p-6 rounded-3xl">
                        <h3 className="mb-4 font-bold flex items-center gap-2">
                            <span>📋</span> Universal Clipboard
                        </h3>
                        <textarea
                            className="w-full h-32 bg-black/20 rounded-xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            placeholder="Paste text here to share..."
                            value={clipboardText}
                            onChange={(e) => setClipboardText(e.target.value)}
                        />
                        <button className="w-full mt-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors font-medium">
                            Broadcast to All
                        </button>
                    </div>

                    {/* History */}
                    <div className="glass-panel p-6 rounded-3xl flex-1 overflow-hidden flex flex-col">
                        <h3 className="mb-4 font-bold flex items-center gap-2">
                            <span>clock</span> Transfer History
                        </h3>
                        <div className="overflow-y-auto flex-1 pr-2 space-y-2">
                            {history.length === 0 && <p className="text-white/30 text-sm text-center py-4">No transfers yet</p>}
                            {history.map((item, i) => (
                                <div key={i} className="bg-white/5 p-3 rounded-xl text-sm flex items-center justify-between">
                                    <div className="truncate flex-1 mr-2">
                                        <p className="font-medium truncate">{item.fileName}</p>
                                        <p className="text-xs text-white/50">{item.type === 'send' ? 'Sent' : 'Received'}</p>
                                    </div>
                                    <span className="text-xs text-white/30">
                                        {(item.size / 1024 / 1024).toFixed(1)} MB
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default App;
