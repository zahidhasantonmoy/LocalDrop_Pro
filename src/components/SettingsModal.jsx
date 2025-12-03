// Settings Modal Component
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function SettingsModal({
    show,
    onClose,
    myUser,
    setMyUser,
    soundEnabled,
    setSoundEnabled,
    notificationsEnabled,
    setNotificationsEnabled,
    notificationService,
    currentTheme
}) {
    const handleSoundToggle = () => {
        const newValue = !soundEnabled;
        setSoundEnabled(newValue);
        notificationService.setSoundEnabled(newValue);
    };

    const handleNotificationToggle = async () => {
        if (!notificationsEnabled) {
            const granted = await notificationService.requestPermission();
            setNotificationsEnabled(granted);
        } else {
            setNotificationsEnabled(false);
        }
    };

    const handleNameChange = (e) => {
        const newName = e.target.value;
        setMyUser({ ...myUser, name: newName });
    };

    return (
        <AnimatePresence>
            {show && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                        onClick={onClose}
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className={`fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full max-w-md ${currentTheme.panel} backdrop-blur-xl border rounded-3xl p-8 z-50 shadow-2xl`}
                    >
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-2xl font-bold">Settings</h2>
                            <button
                                onClick={onClose}
                                className="text-2xl hover:bg-white/10 w-10 h-10 rounded-full transition-colors"
                            >
                                ×
                            </button>
                        </div>

                        <div className="space-y-6">
                            {/* Display Name */}
                            <div>
                                <label className="block text-sm font-medium mb-2 opacity-70">Display Name</label>
                                <input
                                    type="text"
                                    value={myUser.name}
                                    onChange={handleNameChange}
                                    className={`w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 ${currentTheme.text}`}
                                    placeholder="Enter your name"
                                    maxLength={30}
                                />
                                <p className="text-xs opacity-50 mt-1">This name will be visible to your peers</p>
                            </div>

                            {/* Sound Effects */}
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="font-medium">Sound Effects</p>
                                    <p className="text-sm opacity-50">Play sounds for notifications</p>
                                </div>
                                <button
                                    onClick={handleSoundToggle}
                                    className={`w-14 h-8 rounded-full transition-colors ${soundEnabled ? 'bg-blue-600' : 'bg-white/20'}`}
                                >
                                    <div className={`w-6 h-6 bg-white rounded-full transition-transform ${soundEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
                                </button>
                            </div>

                            {/* Browser Notifications */}
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="font-medium">Browser Notifications</p>
                                    <p className="text-sm opacity-50">Get notified when app is in background</p>
                                </div>
                                <button
                                    onClick={handleNotificationToggle}
                                    className={`w-14 h-8 rounded-full transition-colors ${notificationsEnabled ? 'bg-blue-600' : 'bg-white/20'}`}
                                >
                                    <div className={`w-6 h-6 bg-white rounded-full transition-transform ${notificationsEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
                                </button>
                            </div>

                            {/* Info */}
                            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                                <p className="text-sm">
                                    <span className="font-semibold">💡 Tip:</span> Enable notifications to stay updated even when the app is in the background!
                                </p>
                            </div>
                        </div>

                        {/* Close Button */}
                        <button
                            onClick={onClose}
                            className="w-full mt-6 bg-blue-600 hover:bg-blue-500 py-3 rounded-xl font-bold transition-colors"
                        >
                            Done
                        </button>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
