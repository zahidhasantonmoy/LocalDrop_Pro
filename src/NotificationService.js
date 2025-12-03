// NotificationService.js - Browser notifications and sound effects
class NotificationService {
    constructor() {
        this.soundEnabled = JSON.parse(localStorage.getItem('localdrop_sound_enabled') ?? 'true');
        this.notificationEnabled = false;
        this.sounds = {
            connection: new Audio('/sounds/connection.mp3'),
            transferComplete: new Audio('/sounds/transfer-complete.mp3'),
            message: new Audio('/sounds/message.mp3')
        };

        // Set volume and add error handlers
        Object.values(this.sounds).forEach(sound => {
            sound.volume = 0.5;
            sound.onerror = (e) => {
                console.warn('Sound file failed to load:', e);
            };
        });

        // Check notification permission
        if ('Notification' in window) {
            this.notificationEnabled = Notification.permission === 'granted';
        }
    }

    async requestPermission() {
        if (!('Notification' in window)) {
            console.warn('Browser does not support notifications');
            return false;
        }

        if (Notification.permission === 'granted') {
            this.notificationEnabled = true;
            return true;
        }

        if (Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            this.notificationEnabled = permission === 'granted';
            return this.notificationEnabled;
        }

        return false;
    }

    playSound(type) {
        if (!this.soundEnabled) return;

        const sound = this.sounds[type];
        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(err => console.warn('Sound play failed:', err));
        }
    }

    setSoundEnabled(enabled) {
        this.soundEnabled = enabled;
        localStorage.setItem('localdrop_sound_enabled', JSON.stringify(enabled));
    }

    notify(title, options = {}) {
        // Play sound
        if (options.sound) {
            this.playSound(options.sound);
        }

        // Show notification if enabled and page is not focused
        if (this.notificationEnabled && document.hidden) {
            const notification = new Notification(title, {
                icon: '/favicon.ico',
                badge: '/favicon.ico',
                ...options
            });

            // Auto-close after 5 seconds
            setTimeout(() => notification.close(), 5000);

            // Focus window on click
            notification.onclick = () => {
                window.focus();
                notification.close();
            };

            return notification;
        }

        return null;
    }

    // Helper methods for common notifications
    notifyConnection(peerName) {
        this.notify(`${peerName} connected`, {
            body: 'You can now start transferring files',
            sound: 'connection',
            tag: 'connection'
        });
    }

    notifyDisconnection(peerName) {
        this.notify(`${peerName} disconnected`, {
            body: 'Connection has been closed',
            tag: 'connection'
        });
    }

    notifyTransferComplete(fileName, type) {
        const action = type === 'send' ? 'sent to peer' : 'received';
        this.notify(`Transfer complete`, {
            body: `${fileName} ${action}`,
            sound: 'transferComplete',
            tag: 'transfer'
        });
    }

    notifyMessage(peerName, message) {
        this.notify(`Message from ${peerName}`, {
            body: message.length > 50 ? message.substring(0, 50) + '...' : message,
            sound: 'message',
            tag: 'message-' + peerName
        });
    }

    notifyIncomingCall(peerName) {
        this.notify(`Incoming call from ${peerName}`, {
            body: 'Click to answer',
            sound: 'connection',
            tag: 'call',
            requireInteraction: true
        });
    }
}

export default new NotificationService();
