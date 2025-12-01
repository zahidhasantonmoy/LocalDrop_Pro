import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import JSZip from 'jszip';
import { useWebRTC } from './useWebRTC';

// Generate a random user name
const generateUser = () => {
    const names = ['Nebula', 'Quasar', 'Pulsar', 'Nova', 'Zenith', 'Cosmos', 'Orbit'];
    const name = names[Math.floor(Math.random() * names.length)];
    return { name };
};

function App() {
    // Persistence: Load User
    const [myUser, setMyUser] = useState(() => {
        const saved = localStorage.getItem('localdrop_user');
        return saved ? JSON.parse(saved) : generateUser();
    });

    useEffect(() => {
        localStorage.setItem('localdrop_user', JSON.stringify(myUser));
    }, [myUser]);

    const {
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
    } = useWebRTC(myUser);

    const [showQR, setShowQR] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const [clipboardInput, setClipboardInput] = useState('');
    const [dragOver, setDragOver] = useState(null); // peerId
    const [targetId, setTargetId] = useState('');

    // Persistence: Load History
    const [history, setHistory] = useState(() => {
        const saved = localStorage.getItem('localdrop_history');
        return saved ? JSON.parse(saved) : [];
    });

    useEffect(() => {
        localStorage.setItem('localdrop_history', JSON.stringify(history));
    }, [history]);

    const fileInputRef = useRef(null);
    const [selectedPeer, setSelectedPeer] = useState(null);

    // QR Scanner Logic
    useEffect(() => {
        if (showScanner) {
            const scanner = new Html5QrcodeScanner(
                "reader",
                { fps: 10, qrbox: { width: 250, height: 250 } },
              /* verbose= */ false
            );

            scanner.render((decodedText) => {
                // Parse URL to get peer ID
                try {
                    const url = new URL(decodedText);
                    const peer = url.searchParams.get('peer');
                    if (peer && peer !== myPeerId) {
                        connectToPeer(peer);
                        scanner.clear();
                        setShowScanner(false);
                    }
                } catch (e) {
                    console.error('Invalid QR Code', e);
                }
            }, (error) => {
                // console.warn(error);
            });

            return () => {
                scanner.clear().catch(error => console.error("Failed to clear scanner", error));
            };
        }
    }, [showScanner, myPeerId]);

    // Sound Effects
    const playSound = (type) => {
        // Placeholder
    };

    useEffect(() => {
        // Check URL for peer ID to connect to
        const params = new URLSearchParams(window.location.search);
        const peer = params.get('peer');
        if (peer && peer !== myPeerId) {
            setTargetId(peer);
        }
    }, [myPeerId]);

    useEffect(() => {
        // Update history when transfers complete
        Object.entries(transfers).forEach(([peerId, transfer]) => {
            if (transfer.status === 'completed' || transfer.status === 'cancelled') {
                setHistory(prev => {
                    // Avoid duplicates based on startTime
                    if (prev.find(h => h.startTime === transfer.startTime)) return prev;
                    const newItem = { ...transfer, peerId, timestamp: new Date() };
                    playSound('complete');
                    return [newItem, ...prev];
                });
            }
        });
    }, [transfers]);

    const handleConnect = (e) => {
        e.preventDefault();
        if (targetId) {
            connectToPeer(targetId);
            setTargetId('');
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

    const formatSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatSpeed = (bytesPerSec) => {
        if (!bytesPerSec) return '0 KB/s';
        return formatSize(bytesPerSec) + '/s';
    };

    const handleSendClipboard = () => {
        if (clipboardInput.trim()) {
            sendClipboard(clipboardInput);
            setClipboardInput('');
        }
    };

    const localUrl = `${window.location.origin}?peer=${myPeerId}`;

    return (
        <div className="min-h-screen text-white p-4 md:p-8 relative font-sans overflow-x-hidden">
            <input type="file" multiple ref={fileInputRef} className="hidden" onChange={handleFileSelect} />

            {/* Background Elements */}
            <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
                <motion.div
                    animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 0] }}
                    transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                    className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-600 rounded-full mix-blend-multiply filter blur-[128px] opacity-40"
                />
                <motion.div
                    animate={{ scale: [1, 1.1, 1], rotate: [0, -60, 0] }}
                    transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                    className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-600 rounded-full mix-blend-multiply filter blur-[128px] opacity-40"
                />
            </div>

            {/* Header */}
            <header className="flex flex-col md:flex-row justify-between items-center mb-8 glass-panel p-6 rounded-3xl gap-6 shadow-2xl border border-white/10">
                <div className="flex items-center gap-6 w-full md:w-auto">
                    <div className="relative">
                        <img src={`https://api.dicebear.com/7.x/bottts/svg?seed=${myPeerId}`} alt="Me" className="w-16 h-16 md:w-20 md:h-20 rounded-2xl border-2 border-white/20 bg-white/5 p-1" />
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-4 border-[#1a1a1a]" />
                    </div>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">{myUser.name}</h1>
                        <div className="flex items-center gap-3 mt-1">
                            <span className="text-sm text-white/50 font-mono bg-black/30 px-3 py-1 rounded-lg">ID: {myPeerId}</span>
                            <button
                                onClick={() => setShowQR(!showQR)}
                                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-xs"
                            >
                                Show QR
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3 w-full md:w-auto items-center">
                    <form onSubmit={handleConnect} className="flex gap-3 w-full md:w-auto bg-black/20 p-2 rounded-2xl border border-white/5 flex-1">
                        <input
                            type="text"
                            placeholder="Enter 6-digit ID"
                            className="bg-transparent border-none text-white placeholder-white/30 p-3 text-lg focus:outline-none flex-1 md:w-48 font-mono text-center"
                            value={targetId}
                            onChange={(e) => setTargetId(e.target.value)}
                            maxLength={6}
                        />
                        <button type="submit" className="bg-blue-600 hover:bg-blue-500 px-6 md:px-8 py-3 rounded-xl font-bold text-sm transition-all shadow-lg hover:shadow-blue-500/25">
                            Connect
                        </button>
                    </form>
                    <button
                        onClick={() => setShowScanner(!showScanner)}
                        className="p-4 rounded-2xl bg-white/10 hover:bg-white/20 transition-colors"
                        title="Scan QR Code"
                    >
                        📷
                    </button>
                </div>
            </header>

            {/* Main Grid */}
            <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Connection Area */}
                <div className="lg:col-span-2 grid grid-cols-1 gap-6">
                    <AnimatePresence>
                        {Object.values(connections).map(conn => (
                            <motion.div
                                key={conn.peer}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className={`glass-panel p-6 md:p-8 rounded-3xl relative overflow-hidden transition-all duration-300 ${dragOver === conn.peer ? 'ring-4 ring-blue-500 bg-white/10 scale-[1.02]' : ''}`}
                                onDragOver={(e) => handleDragOver(e, conn.peer)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, conn.peer)}
                            >
                                <div className="flex flex-col md:flex-row items-center gap-8 z-10 relative">
                                    <div className="relative shrink-0">
                                        <img src={`https://api.dicebear.com/7.x/bottts/svg?seed=${conn.peer}`} alt="Peer" className="w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-black/20 p-2" />
                                        <div className="absolute -bottom-2 -right-2 w-6 h-6 bg-green-500 rounded-full border-4 border-[#1a1a1a]" />
                                    </div>

                                    <div className="flex-1 text-center md:text-left w-full">
                                        <h2 className="text-2xl font-bold mb-1">Connected Peer</h2>
                                        <p className="text-white/40 font-mono mb-6">ID: {conn.peer}</p>

                                        <div className="flex flex-wrap justify-center md:justify-start gap-4">
                                            <button
                                                onClick={() => openFilePicker(conn.peer)}
                                                className="px-8 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition-all shadow-lg hover:shadow-blue-500/25 flex items-center gap-2"
                                            >
                                                <span>📤</span> Send File
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Active Transfer Card */}
                                <AnimatePresence>
                                    {transfers[conn.peer] && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="mt-8 bg-black/20 rounded-2xl p-6 border border-white/5"
                                        >
                                            <div className="flex justify-between items-start mb-4">
                                                <div className="overflow-hidden">
                                                    <h3 className="font-bold text-lg truncate max-w-[200px] md:max-w-md">{transfers[conn.peer].fileName}</h3>
                                                    <p className="text-sm text-white/50 mt-1 flex gap-2">
                                                        <span>{formatSize(transfers[conn.peer].size)}</span>
                                                        {transfers[conn.peer].status === 'in-progress' && (
                                                            <span className="text-blue-400">• {formatSpeed(transfers[conn.peer].speed)}</span>
                                                        )}
                                                    </p>
                                                </div>
                                                <div className="text-right shrink-0 ml-2">
                                                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${transfers[conn.peer].status === 'completed' ? 'bg-green-500/20 text-green-400' :
                                                            transfers[conn.peer].status === 'cancelled' ? 'bg-red-500/20 text-red-400' :
                                                                transfers[conn.peer].status === 'paused' ? 'bg-yellow-500/20 text-yellow-400' :
                                                                    'bg-blue-500/20 text-blue-400'
                                                        }`}>
                                                        {transfers[conn.peer].status.toUpperCase()}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Progress Bar */}
                                            <div className="w-full bg-black/40 rounded-full h-3 overflow-hidden relative mb-4">
                                                <motion.div
                                                    className={`absolute top-0 left-0 h-full ${transfers[conn.peer].status === 'completed' ? 'bg-green-500' :
                                                            transfers[conn.peer].status === 'cancelled' ? 'bg-red-500' :
                                                                transfers[conn.peer].status === 'paused' ? 'bg-yellow-500' :
                                                                    'bg-blue-500'
                                                        }`}
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${(transfers[conn.peer].type === 'send' ? transfers[conn.peer].sent : transfers[conn.peer].received) / transfers[conn.peer].size * 100}%` }}
                                                />
                                            </div>

                                            {/* Controls */}
                                            <div className="flex justify-end gap-3">
                                                {transfers[conn.peer].status === 'in-progress' && (
                                                    <>
                                                        <button
                                                            onClick={() => pauseTransfer(conn.peer)}
                                                            className="px-4 py-2 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 rounded-lg text-sm font-medium transition-colors"
                                                        >
                                                            Pause
                                                        </button>
                                                        <button
                                                            onClick={() => cancelTransfer(conn.peer)}
                                                            className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm font-medium transition-colors"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </>
                                                )}
                                                {transfers[conn.peer].status === 'paused' && (
                                                    <>
                                                        <button
                                                            onClick={() => resumeTransfer(conn.peer)}
                                                            className="px-4 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 rounded-lg text-sm font-medium transition-colors"
                                                        >
                                                            Resume
                                                        </button>
                                                        <button
                                                            onClick={() => cancelTransfer(conn.peer)}
                                                            className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm font-medium transition-colors"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </>
                                                )}
                                                {transfers[conn.peer].status === 'completed' && transfers[conn.peer].type === 'receive' && transfers[conn.peer].blobUrl && (
                                                    <a
                                                        href={transfers[conn.peer].blobUrl}
                                                        download={transfers[conn.peer].fileName}
                                                        className="px-6 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-bold transition-colors shadow-lg hover:shadow-green-500/25"
                                                    >
                                                        Download
                                                    </a>
                                                )}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </motion.div>
                        ))}
                    </AnimatePresence>

                    {Object.keys(connections).length === 0 && (
                        <div className="flex flex-col items-center justify-center p-16 text-white/30 border-2 border-dashed border-white/10 rounded-3xl bg-white/5">
                            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
                                <span className="text-4xl">📡</span>
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">No Connections</h3>
                            <p className="text-center max-w-xs">Share your 6-digit ID or scan the QR code to start transferring files instantly.</p>
                        </div>
                    )}
                </div>

                {/* Sidebar */}
                <div className="flex flex-col gap-6">
                    {/* Universal Clipboard */}
                    <div className="glass-panel p-6 rounded-3xl border border-white/10">
                        <h3 className="mb-4 font-bold flex items-center gap-2">
                            <span>📋</span> Universal Clipboard
                        </h3>
                        <div className="flex gap-2 mb-4">
                            <input
                                type="text"
                                className="flex-1 bg-black/20 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Type or paste text..."
                                value={clipboardInput}
                                onChange={(e) => setClipboardInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSendClipboard()}
                            />
                            <button
                                onClick={handleSendClipboard}
                                className="bg-blue-600 hover:bg-blue-500 px-4 rounded-xl font-bold transition-colors"
                            >
                                Send
                            </button>
                        </div>

                        {/* Clipboard History */}
                        <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                            {clipboardHistory.map((item, i) => (
                                <div key={i} className="bg-white/5 p-3 rounded-xl text-sm break-all">
                                    <p>{item.text}</p>
                                    <p className="text-[10px] text-white/30 mt-1 text-right">
                                        {new Date(item.timestamp).toLocaleTimeString()}
                                    </p>
                                </div>
                            ))}
                            {clipboardHistory.length === 0 && (
                                <p className="text-center text-white/30 text-xs py-4">No clipboard history</p>
                            )}
                        </div>
                    </div>

                    {/* QR Code & Scanner */}
                    <AnimatePresence>
                        {showQR && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="glass-panel p-8 rounded-3xl flex flex-col items-center shadow-2xl border border-white/10"
                            >
                                <h3 className="mb-6 font-bold text-lg">Scan to Connect</h3>
                                <div className="bg-white p-4 rounded-2xl shadow-inner">
                                    <QRCodeSVG value={localUrl} size={200} />
                                </div>
                                <p className="mt-6 text-xs text-center break-all text-white/40 bg-black/20 p-3 rounded-lg w-full">{localUrl}</p>
                            </motion.div>
                        )}
                        {showScanner && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="glass-panel p-4 rounded-3xl flex flex-col items-center shadow-2xl border border-white/10"
                            >
                                <h3 className="mb-4 font-bold text-lg">Point Camera at QR Code</h3>
                                <div id="reader" className="w-full max-w-xs overflow-hidden rounded-xl"></div>
                                <button
                                    onClick={() => setShowScanner(false)}
                                    className="mt-4 text-sm text-red-400 hover:text-red-300"
                                >
                                    Close Scanner
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* History */}
                    <div className="glass-panel p-6 rounded-3xl flex-1 overflow-hidden flex flex-col min-h-[400px] border border-white/10">
                        <h3 className="mb-6 font-bold flex items-center gap-3 text-lg">
                            <span className="bg-blue-500/20 p-2 rounded-lg text-blue-400">clock</span>
                            Transfer History
                        </h3>
                        <div className="overflow-y-auto flex-1 pr-2 space-y-3 custom-scrollbar">
                            {history.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center text-white/30">
                                    <p>No transfers yet</p>
                                </div>
                            )}
                            {history.map((item, i) => (
                                <div key={i} className="bg-white/5 hover:bg-white/10 p-4 rounded-xl transition-colors border border-white/5">
                                    <div className="flex justify-between items-start mb-2">
                                        <p className="font-medium truncate flex-1 mr-2" title={item.fileName}>{item.fileName}</p>
                                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${item.type === 'send' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'
                                            }`}>
                                            {item.type === 'send' ? 'SENT' : 'RECEIVED'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs text-white/40">
                                        <span>{formatSize(item.size)}</span>
                                        <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                                    </div>
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
