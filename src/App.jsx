import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import JSZip from 'jszip';
import { useWebRTC } from './useWebRTC';
import { SettingsModal } from './components/SettingsModal';

// Themes
const THEMES = {
    aurora: {
        name: 'Aurora',
        bg: 'linear-gradient(45deg, #1a1a2e, #16213e, #0f3460)',
        accent: 'from-blue-400 to-purple-400',
        panel: 'bg-white/5 border-white/10',
        text: 'text-white'
    },
    cyberpunk: {
        name: 'Cyberpunk',
        bg: 'linear-gradient(45deg, #000000, #1a1a1a, #2d2d2d)',
        accent: 'from-yellow-400 to-pink-500',
        panel: 'bg-black/40 border-yellow-500/50',
        text: 'text-yellow-50'
    },
    minimal: {
        name: 'Minimal',
        bg: 'linear-gradient(45deg, #f3f4f6, #e5e7eb, #d1d5db)',
        accent: 'from-gray-700 to-gray-900',
        panel: 'bg-white/60 border-gray-200 shadow-xl',
        text: 'text-gray-900'
    }
};

const generateUser = () => {
    const names = ['Nebula', 'Quasar', 'Pulsar', 'Nova', 'Zenith', 'Cosmos', 'Orbit'];
    const name = names[Math.floor(Math.random() * names.length)];
    return { name };
};

function App() {
    const [myUser, setMyUser] = useState(() => {
        const saved = localStorage.getItem('localdrop_user');
        return saved ? JSON.parse(saved) : generateUser();
    });

    const [theme, setTheme] = useState(() => localStorage.getItem('localdrop_theme') || 'aurora');
    const currentTheme = THEMES[theme];

    useEffect(() => {
        localStorage.setItem('localdrop_user', JSON.stringify(myUser));
    }, [myUser]);

    useEffect(() => {
        localStorage.setItem('localdrop_theme', theme);
    }, [theme]);

    const {
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
    } = useWebRTC(myUser);

    const [showQR, setShowQR] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [dragOver, setDragOver] = useState(null);
    const [targetId, setTargetId] = useState('');

    const [history, setHistory] = useState(() => {
        const saved = localStorage.getItem('localdrop_history');
        return saved ? JSON.parse(saved) : [];
    });

    useEffect(() => {
        localStorage.setItem('localdrop_history', JSON.stringify(history));
    }, [history]);

    const fileInputRef = useRef(null);
    const [selectedPeer, setSelectedPeer] = useState(null);
    const chatEndRef = useRef(null);
    const [showSettings, setShowSettings] = useState(false);
    const [editingName, setEditingName] = useState('');
    const [soundEnabled, setSoundEnabled] = useState(notificationService.soundEnabled);
    const [notificationsEnabled, setNotificationsEnabled] = useState(notificationService.notificationEnabled);

    // Auto-scroll chat
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory]);

    // QR Scanner Logic
    useEffect(() => {
        if (showScanner) {
            const scanner = new Html5QrcodeScanner(
                "reader",
                { fps: 10, qrbox: { width: 250, height: 250 } },
                false
            );

            scanner.render((decodedText) => {
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
            }, (error) => { });

            return () => {
                scanner.clear().catch(error => console.error("Failed to clear scanner", error));
            };
        }
    }, [showScanner, myPeerId]);

    // Share Target & URL Params
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const peer = params.get('peer');
        if (peer && peer !== myPeerId) {
            setTargetId(peer);
        }

        // Check for shared files
        if (params.get('share') === 'true') {
            const loadSharedFiles = async () => {
                try {
                    const db = await new Promise((resolve, reject) => {
                        const req = indexedDB.open('localdrop-share', 1);
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = () => reject(req.error);
                    });

                    const tx = db.transaction('files', 'readwrite');
                    const store = tx.objectStore('files');
                    const req = store.get('shared');

                    req.onsuccess = () => {
                        const files = req.result;
                        if (files && files.length > 0) {
                            console.log('Found shared files:', files);
                            store.delete('shared');
                            alert(`Ready to share ${files.length} files! Connect to a peer to send.`);
                        }
                    };
                } catch (e) {
                    console.error('Error loading shared files:', e);
                }
            };
            loadSharedFiles();
            window.history.replaceState({}, '', '/');
        }
    }, [myPeerId]);

    useEffect(() => {
        Object.entries(transfers).forEach(([peerId, transfer]) => {
            if (transfer.status === 'completed' || transfer.status === 'cancelled') {
                setHistory(prev => {
                    if (prev.find(h => h.startTime === transfer.startTime)) return prev;
                    const newItem = { ...transfer, peerId, timestamp: new Date() };
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
            const filesToSend = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : (items[i].getAsEntry ? items[i].getAsEntry() : null);
                if (item) {
                    if (item.isFile) {
                        const file = items[i].getAsFile();
                        filesToSend.push(file);
                    } else if (item.isDirectory) {
                        const zip = new JSZip();
                        await addDirectoryToZip(zip, item);
                        const content = await zip.generateAsync({ type: "blob" });
                        const file = new File([content], `${item.name}.zip`, { type: "application/zip" });
                        filesToSend.push(file);
                    }
                } else if (items[i].kind === 'file') {
                    const file = items[i].getAsFile();
                    filesToSend.push(file);
                }
            }
            if (filesToSend.length > 0) {
                sendFiles(peerId, filesToSend);
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
            const files = Array.from(e.target.files);
            sendFiles(selectedPeer, files);
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

    const handleSendChat = (peerId) => {
        if (chatInput.trim()) {
            sendChatMessage(peerId, chatInput);
            setChatInput('');
        }
    };

    const localUrl = `${window.location.origin}?peer=${myPeerId}`;

    return (
        <div className={`min-h-screen ${currentTheme.text} p-4 md:p-8 relative font-sans overflow-x-hidden transition-colors duration-500`} style={{ background: currentTheme.bg, backgroundSize: '400% 400%', animation: 'gradientBG 15s ease infinite' }}>
            <input type="file" multiple ref={fileInputRef} className="hidden" onChange={handleFileSelect} />

            {/* Header */}
            <header className={`flex flex-col md:flex-row justify-between items-center mb-8 ${currentTheme.panel} backdrop-blur-xl p-6 rounded-3xl gap-6 border`}>
                <div className="flex items-center gap-6 w-full md:w-auto">
                    <div className="relative">
                        <img src={`https://api.dicebear.com/7.x/bottts/svg?seed=${myPeerId}`} alt="Me" className="w-16 h-16 md:w-20 md:h-20 rounded-2xl border-2 border-white/20 bg-white/5 p-1" />
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-4 border-[#1a1a1a]" />
                    </div>
                    <div>
                        <h1 className={`text-2xl md:text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r ${currentTheme.accent}`}>{myUser.name}</h1>
                        <div className="flex items-center gap-3 mt-1">
                            <span className="text-sm opacity-50 font-mono bg-black/30 px-3 py-1 rounded-lg">ID: {myPeerId}</span>
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
                    <div className="flex gap-2 mr-4">
                        {Object.keys(THEMES).map(t => (
                            <button
                                key={t}
                                onClick={() => setTheme(t)}
                                className={`w-6 h-6 rounded-full border-2 ${theme === t ? 'border-white' : 'border-transparent'}`}
                                style={{ background: THEMES[t].bg }}
                                title={THEMES[t].name}
                            />
                        ))}
                    </div>
                    <form onSubmit={handleConnect} className="flex gap-3 w-full md:w-auto bg-black/20 p-2 rounded-2xl border border-white/5 flex-1">
                        <input
                            type="text"
                            placeholder="Enter 6-digit ID"
                            className={`bg-transparent border-none placeholder-white/30 p-3 text-lg focus:outline-none flex-1 md:w-48 font-mono text-center ${currentTheme.text}`}
                            value={targetId}
                            onChange={(e) => setTargetId(e.target.value)}
                            maxLength={6}
                        />
                        <button type="submit" className="bg-blue-600 hover:bg-blue-500 px-6 md:px-8 py-3 rounded-xl font-bold text-sm transition-all shadow-lg hover:shadow-blue-500/25 text-white">
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
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className="p-4 rounded-2xl bg-white/10 hover:bg-white/20 transition-colors"
                        title="Settings"
                    >
                        ⚙️
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
                                className={`${currentTheme.panel} backdrop-blur-xl p-6 md:p-8 rounded-3xl relative overflow-hidden transition-all duration-300 border ${dragOver === conn.peer ? 'ring-4 ring-blue-500 scale-[1.02]' : ''}`}
                                onDragOver={(e) => handleDragOver(e, conn.peer)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, conn.peer)}
                            >
                                <div className="flex flex-col md:flex-row items-start gap-8 z-10 relative">
                                    <div className="flex-1 w-full">
                                        <div className="flex items-center gap-4 mb-6">
                                            <img src={`https://api.dicebear.com/7.x/bottts/svg?seed=${conn.peer}`} alt="Peer" className="w-16 h-16 rounded-2xl bg-black/20 p-2" />
                                            <div>
                                                <h2 className="text-2xl font-bold">{peerProfiles[conn.peer]?.name || `Peer ${conn.peer.substring(0, 6)}`}</h2>
                                                <p className="opacity-40 font-mono">ID: {conn.peer}</p>
                                            </div>
                                            <div className="ml-auto">
                                                <button
                                                    onClick={() => openFilePicker(conn.peer)}
                                                    className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition-all shadow-lg hover:shadow-blue-500/25 flex items-center gap-2 text-white text-sm"
                                                >
                                                    <span>📤</span> Send Files
                                                </button>
                                            </div>
                                        </div>

                                        {/* Chat Section */}
                                        <div className="bg-black/20 rounded-2xl p-4 h-64 flex flex-col mb-6 border border-white/5">
                                            <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar mb-4">
                                                {(chatHistory[conn.peer] || []).map((msg, i) => (
                                                    <div key={i} className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                                                        <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${msg.sender === 'me'
                                                            ? 'bg-blue-600 text-white rounded-br-none'
                                                            : 'bg-white/10 text-white rounded-bl-none'
                                                            }`}>
                                                            {msg.text}
                                                        </div>
                                                    </div>
                                                ))}
                                                <div ref={chatEndRef} />
                                            </div>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    className="flex-1 bg-white/5 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                    placeholder="Type a message..."
                                                    value={chatInput}
                                                    onChange={(e) => setChatInput(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleSendChat(conn.peer)}
                                                />
                                                <button
                                                    onClick={() => handleSendChat(conn.peer)}
                                                    className="bg-blue-600 hover:bg-blue-500 px-4 rounded-xl font-bold transition-colors text-white"
                                                >
                                                    ➤
                                                </button>
                                            </div>
                                        </div>

                                        {/* Active Transfer Card */}
                                        <AnimatePresence>
                                            {transfers[conn.peer] && (
                                                <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: 'auto', opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    className="bg-black/20 rounded-2xl p-6 border border-white/5"
                                                >
                                                    <div className="flex justify-between items-start mb-4">
                                                        <div className="overflow-hidden">
                                                            <h3 className="font-bold text-lg truncate max-w-[200px] md:max-w-md">{transfers[conn.peer].fileName}</h3>
                                                            <p className="text-sm opacity-50 mt-1 flex gap-2">
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
                                                    <div className="flex justify-between items-center">
                                                        <div className="text-xs opacity-50">
                                                            {fileQueue[conn.peer] && fileQueue[conn.peer].length > 0 && (
                                                                <span>+{fileQueue[conn.peer].length} files queued</span>
                                                            )}
                                                        </div>
                                                        <div className="flex gap-3">
                                                            {transfers[conn.peer].status === 'in-progress' && (
                                                                <>
                                                                    <button onClick={() => pauseTransfer(conn.peer)} className="px-4 py-2 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 rounded-lg text-sm font-medium transition-colors">Pause</button>
                                                                    <button onClick={() => cancelTransfer(conn.peer)} className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm font-medium transition-colors">Cancel</button>
                                                                </>
                                                            )}
                                                            {transfers[conn.peer].status === 'paused' && (
                                                                <>
                                                                    <button onClick={() => resumeTransfer(conn.peer)} className="px-4 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 rounded-lg text-sm font-medium transition-colors">Resume</button>
                                                                    <button onClick={() => cancelTransfer(conn.peer)} className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm font-medium transition-colors">Cancel</button>
                                                                </>
                                                            )}
                                                            {transfers[conn.peer].status === 'completed' && transfers[conn.peer].type === 'receive' && transfers[conn.peer].blobUrl && (
                                                                <a href={transfers[conn.peer].blobUrl} download={transfers[conn.peer].fileName} className="px-6 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-bold transition-colors shadow-lg hover:shadow-green-500/25 text-white">Download</a>
                                                            )}
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>

                    {Object.keys(connections).length === 0 && (
                        <div className={`flex flex-col items-center justify-center p-16 opacity-30 border-2 border-dashed border-white/10 rounded-3xl bg-white/5`}>
                            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
                                <span className="text-4xl">📡</span>
                            </div>
                            <h3 className="text-xl font-bold mb-2">No Connections</h3>
                            <p className="text-center max-w-xs">Share your 6-digit ID or scan the QR code to start transferring files instantly.</p>
                        </div>
                    )}
                </div>

                {/* Sidebar */}
                <div className="flex flex-col gap-6">
                    {/* QR Code & Scanner */}
                    <AnimatePresence>
                        {showQR && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className={`${currentTheme.panel} backdrop-blur-xl p-8 rounded-3xl flex flex-col items-center shadow-2xl border`}
                            >
                                <h3 className="mb-6 font-bold text-lg">Scan to Connect</h3>
                                <div className="bg-white p-4 rounded-2xl shadow-inner">
                                    <QRCodeSVG value={localUrl} size={200} />
                                </div>
                                <p className="mt-6 text-xs text-center break-all opacity-40 bg-black/20 p-3 rounded-lg w-full">{localUrl}</p>
                            </motion.div>
                        )}
                        {showScanner && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className={`${currentTheme.panel} backdrop-blur-xl p-4 rounded-3xl flex flex-col items-center shadow-2xl border`}
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
                    <div className={`${currentTheme.panel} backdrop-blur-xl p-6 rounded-3xl flex-1 overflow-hidden flex flex-col min-h-[400px] border`}>
                        <h3 className="mb-6 font-bold flex items-center gap-3 text-lg">
                            <span className="bg-blue-500/20 p-2 rounded-lg text-blue-400">clock</span>
                            Transfer History
                        </h3>
                        <div className="overflow-y-auto flex-1 pr-2 space-y-3 custom-scrollbar">
                            {history.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center opacity-30">
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
                                    <div className="flex justify-between items-center text-xs opacity-40">
                                        <span>{formatSize(item.size)}</span>
                                        <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </main>

            {/* Settings Modal */}
            <SettingsModal
                show={showSettings}
                onClose={() => setShowSettings(false)}
                myUser={myUser}
                setMyUser={setMyUser}
                soundEnabled={soundEnabled}
                setSoundEnabled={setSoundEnabled}
                notificationsEnabled={notificationsEnabled}
                setNotificationsEnabled={setNotificationsEnabled}
                notificationService={notificationService}
                currentTheme={currentTheme}
            />
        </div>
    );
}

export default App;
