/**
 * script.js
 * تطبيق الاجتماعات الصوتية ومشاركة الشاشة
 * WebRTC + simple-peer + Socket.io
 */

'use strict';

// ═══════════════════════════════════════════════════════
// اتصال Socket.io
// ═══════════════════════════════════════════════════════
const socket = io();

// ═══════════════════════════════════════════════════════
// المتغيرات العامة
// ═══════════════════════════════════════════════════════
let localStream = null;        // تيار الميكروفون المحلي
let screenStream = null;       // تيار الشاشة المشتركة
let localScreenTrack = null;   // مسار فيديو الشاشة

// peers: { [socketId]: SimplePeer instance }
const peers = {};

// معلومات المستخدم الحالي
const myUserId = generateUserId();
let myUserName = generateUserName();
let currentRoomId = null;
let isMuted = false;
let isSharing = false;

// المشاركون: { [socketId]: { userId, userName, isMuted, isSharing, isSpeaking } }
const participants = {};

// لاكتشاف الصوت
let audioContext = null;
let analyser = null;
let microphone = null;
let speechInterval = null;

// ═══════════════════════════════════════════════════════
// عناصر الواجهة
// ═══════════════════════════════════════════════════════
const homePage = document.getElementById('home-page');
const roomPage = document.getElementById('room-page');
const createRoomBtn = document.getElementById('create-room-btn');
const joinLinkInput = document.getElementById('join-link-input');
const joinBtn = document.getElementById('join-btn');
const roomIdDisplay = document.getElementById('room-id-display');
const copyLinkBtn = document.getElementById('copy-link-btn');
const leaveBtn = document.getElementById('leave-btn');
const muteBtn = document.getElementById('mute-btn');
const screenBtn = document.getElementById('screen-btn');
const participantsGrid = document.getElementById('participants-grid');
const participantCount = document.getElementById('participant-count');
const audioContainer = document.getElementById('audio-container');
const screenArea = document.getElementById('screen-area');
const remoteScreenVideo = document.getElementById('remote-screen-video');
const screenSharerName = document.getElementById('screen-sharer-name');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const fullscreenIcon = document.getElementById('fullscreen-icon');
const errorClose = document.getElementById('error-close-btn');

// ═══════════════════════════════════════════════════════
// دوال مساعدة
// ═══════════════════════════════════════════════════════

/** توليد معرف فريد للمستخدم */
function generateUserId() {
    return 'u_' + Math.random().toString(36).slice(2, 10);
}

/** توليد اسم مؤقت للمستخدم */
function generateUserName() {
    const adjectives = ['سريع', 'ذكي', 'نشيط', 'مبدع', 'هادئ', 'مرح', 'دقيق', 'ودود'];
    const nouns = ['نسر', 'قمر', 'نجم', 'بحر', 'جبل', 'ريح', 'ضوء', 'وردة'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj} ${noun}`;
}

/** استخراج roomId من URL */
function getRoomIdFromURL() {
    const path = window.location.pathname;
    const match = path.match(/^\/room\/([a-zA-Z0-9_-]+)$/);
    return match ? match[1] : null;
}

/** توليد roomId عشوائي */
function generateRoomId() {
    return Math.random().toString(36).slice(2, 9);
}

/** عرض رسالة Toast (نظام الرسالة الواحدة) */
function showToast(message, type = 'info', duration = 3000) {
    const icons = { 
        success: 'check-circle', 
        error: 'x-circle', 
        info: 'info', 
        warning: 'alert-circle' 
    };
    const container = document.getElementById('toast-container');
    
    // التحقق مما إذا كانت نفس الرسالة معروضة بالفعل لتجنب التكرار غير الضروري
    const existingToast = container.querySelector('.toast');
    if (existingToast && existingToast.querySelector('span').textContent === message) {
        return; 
    }

    // مسح الرسائل السابقة (لضمان ظهور رسالة واحدة فقط)
    container.innerHTML = '';

    const toast = document.createElement('div');
    toast.className = `toast ${type} flex items-center gap-3 px-6 py-3 rounded-full bg-brand-card/90 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in text-white`;
    toast.innerHTML = `<i data-lucide="${icons[type] || 'info'}" class="w-5 h-5"></i><span class="font-bold text-sm text-center">${message}</span>`;
    container.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
        toast.classList.add('out');
        setTimeout(() => {
            if (toast.parentNode === container) toast.remove();
        }, 300);
    }, duration);
}

/** عرض نافذة خطأ */
function showError(title, message) {
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-message').textContent = message;
    document.getElementById('error-modal').classList.remove('hidden');
}

errorClose.addEventListener('click', () => {
    document.getElementById('error-modal').classList.add('hidden');
});

/** تحديث عداد المشاركين وتنسيق الشبكة */
function updateParticipantCount() {
    const count = Object.keys(participants).length;
    participantCount.textContent = count;
    
    const isMobile = window.innerWidth < 768;
    
    // استخدام flexbox بدلاً من grid لضمان توازن العناصر عند الأعداد الفردية
    participantsGrid.className = 'flex-1 flex flex-wrap items-center justify-center content-center gap-[22px] w-full h-full mx-auto transition-all duration-500 p-4';
    
    // ضبط الحجم الأقصى بناءً على عدد المشاركين والجهاز
    if (count <= 1) {
        participantsGrid.style.maxWidth = isMobile ? '100%' : '800px';
    } else if (count === 2) {
        participantsGrid.style.maxWidth = isMobile ? '100%' : '1200px';
    } else {
        participantsGrid.style.maxWidth = isMobile ? '100%' : '1400px';
    }

    // تحديث حجم العناصر يدوياً لضمان "التساوي" في حال وجود أعداد فردية
    const tiles = participantsGrid.querySelectorAll('.participant-tile');
    tiles.forEach(tile => {
        if (count === 1) {
            tile.style.width = '100%';
            tile.style.maxHeight = isMobile ? '60vh' : '70vh';
        } else if (count === 2) {
            tile.style.width = isMobile ? '100%' : 'calc(50% - 11px)';
            tile.style.maxHeight = isMobile ? '40vh' : '60vh';
        } else if (count <= 4) {
            tile.style.width = isMobile ? 'calc(50% - 11px)' : 'calc(50% - 11px)';
            tile.style.maxHeight = isMobile ? '30vh' : '45vh';
        } else {
            tile.style.width = isMobile ? 'calc(50% - 11px)' : 'calc(33.33% - 15px)';
            tile.style.maxHeight = isMobile ? '25vh' : '40vh';
        }
    });
}

// تحديث التنسيق عند تغيير حجم المتصفح
window.addEventListener('resize', updateParticipantCount);

// ═══════════════════════════════════════════════════════
// إدارة بطاقات المشاركين
// ═══════════════════════════════════════════════════════

/** الحصول على الأحرف الأولى من الاسم للأفاتار */
function getInitials(name) {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return parts[0][0] + parts[1][0];
    return name.slice(0, 2);
}

/** إضافة مشارك جديد للقائمة (شبكة) */
function addParticipantCard(socketId, data, isMe = false) {
    // تجنب التكرار إذا كان موجوداً بالفعل
    if (participants[socketId]) return;

    participants[socketId] = { ...data, isMe, isMuted: false, isSharing: false };

    const tile = document.createElement('div');
    tile.className = `participant-tile relative aspect-video bg-brand-card border border-brand-border rounded-[2.5rem] flex flex-col items-center justify-center animate-scale-in group overflow-hidden shadow-2xl transition-all duration-300 ${isMe ? 'ring-1 ring-white/10' : ''}`;
    tile.id = `card-${socketId}`;
    
    // صورة رمزية أو أحرف (دائرة كبيرة في المنتصف)
    tile.innerHTML = `
    <div class="participant-avatar w-24 h-24 md:w-32 md:h-32 rounded-full bg-white/5 flex items-center justify-center font-bold text-3xl md:text-4xl text-white border-2 border-brand-border relative z-10 transition-transform duration-500 group-hover:scale-105">
      ${getInitials(data.userName)}
      <div class="speaking-ring absolute inset-0 rounded-full border-4 border-white/40 hidden"></div>
    </div>
    
    <!-- خلفية خفيفة متدرجة -->
    <div class="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent opacity-50"></div>

    <!-- اسم المشارك في الأسفل -->
    <div class="absolute bottom-6 left-6 right-6 z-20 flex items-center justify-between">
      <div class="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/5">
        <span class="participant-name font-bold text-xs md:text-sm text-white truncate max-w-[100px] md:max-w-none">${data.userName}</span>
        ${isMe ? '<span class="text-[8px] bg-white text-black px-1.5 py-0.5 rounded-lg font-black uppercase">أنت</span>' : ''}
      </div>

      <div class="flex items-center gap-2">
        <span class="mute-indicator hidden w-8 h-8 bg-red-500/20 backdrop-blur-md border border-red-500/30 rounded-full flex items-center justify-center text-red-500 shadow-lg">
          <i data-lucide="mic-off" class="w-4 h-4"></i>
        </span>
        <span class="sharing-indicator hidden w-8 h-8 bg-green-500/20 backdrop-blur-md border border-green-500/30 rounded-full flex items-center justify-center text-green-500 shadow-lg">
          <i data-lucide="monitor" class="w-4 h-4"></i>
        </span>
      </div>
    </div>
  `;

    participantsGrid.appendChild(tile);
    lucide.createIcons();
    updateParticipantCount();
}

/** إزالة مشارك من القائمة */
function removeParticipantCard(socketId) {
    const card = document.getElementById(`card-${socketId}`);
    if (card) {
        card.style.transform = 'scale(0)';
        card.style.opacity = '0';
        card.style.transition = 'all 0.3s ease';
        setTimeout(() => card.remove(), 300);
    }
    delete participants[socketId];
    updateParticipantCount();
}

/** تحديث حالة مشاركة الشاشة لمشارك */
function updateParticipantScreenState(socketId, isShareState) {
    const card = document.getElementById(`card-${socketId}`);
    if (!card) return;
    
    const indicator = card.querySelector('.sharing-indicator');
    if (indicator) {
        if (isShareState) indicator.classList.remove('hidden');
        else indicator.classList.add('hidden');
    }

    if (participants[socketId]) {
        participants[socketId].isSharing = isShareState;
    }
}

// ═══════════════════════════════════════════════════════
// الوصول للميكروفون
// ═══════════════════════════════════════════════════════

async function getLocalAudio() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 48000,
            },
            video: false,
        });
        
        // إعداد مراقبة مستوى الصوت
        startAudioLevelDetection();
        
        return true;
    } catch (err) {
        console.error('خطأ في الوصول للميكروفون:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            showError(
                'إذن الميكروفون مرفوض',
                'يحتاج التطبيق إلى إذن للوصول إلى الميكروفون. يرجى السماح بالوصول في إعدادات المتصفح وإعادة المحاولة.'
            );
        } else if (err.name === 'NotFoundError') {
            showError(
                'لا يوجد ميكروفون',
                'لم يتم العثور على ميكروفون في جهازك. يرجى توصيل ميكروفون والمحاولة مجدداً.'
            );
        } else {
            showError('خطأ في الميكروفون', `حدث خطأ: ${err.message}`);
        }
        return false;
    }
}

/** مراقبة مستوى الصوت المحلي */
function startAudioLevelDetection() {
    if (!localStream) return;

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(localStream);
        microphone.connect(analyser);
        analyser.fftSize = 512;
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        let wasSpeaking = false;

        speechInterval = setInterval(() => {
            if (isMuted) {
                if (wasSpeaking) toggleSpeakingUI(socket.id, false);
                wasSpeaking = false;
                return;
            }

            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            const average = sum / bufferLength;
            const isSpeaking = average > 25; // عتبة الصوت

            if (isSpeaking !== wasSpeaking) {
                wasSpeaking = isSpeaking;
                toggleSpeakingUI(socket.id, isSpeaking);
                // إرسال الحالة للبقية
                socket.emit('toggle-speaking', { roomId: currentRoomId, isSpeaking });
            }
        }, 150);
    } catch (e) {
        console.warn('تعذر تهيئة AudioContext:', e);
    }
}

/** تفعيل/تعطيل مؤشر التحدث في الواجهة */
function toggleSpeakingUI(socketId, isSpeaking) {
    const card = document.getElementById(`card-${socketId}`);
    if (!card) return;
    
    const ring = card.querySelector('.speaking-ring');
    if (!ring) return;

    if (isSpeaking) {
        ring.classList.remove('hidden');
    } else {
        ring.classList.add('hidden');
    }
}

// ═══════════════════════════════════════════════════════
// إنشاء اتصال Peer (WebRTC)
// ═══════════════════════════════════════════════════════

/**
 * إنشاء اتصال simple-peer مع مستخدم بعيد
 * @param {string} remoteSocketId - socket ID للمستخدم البعيد
 * @param {boolean} initiator - هل هذا المستخدم هو المبادر؟
 * @param {string} remoteUserId - userId للمستخدم البعيد
 * @param {string} remoteUserName - اسم المستخدم البعيد
 */
function createPeer(remoteSocketId, initiator, remoteUserId, remoteUserName) {
    if (peers[remoteSocketId]) {
        peers[remoteSocketId].destroy();
    }

    const streams = [];
    if (localStream) streams.push(localStream);

    const peer = new SimplePeer({
        initiator,
        trickle: true,
        stream: localStream || undefined,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
            ],
        },
    });

    // إرسال إشارة للمستخدم البعيد عبر الخادم
    peer.on('signal', (signalData) => {
        if (signalData.type === 'offer') {
            socket.emit('offer', {
                targetSocketId: remoteSocketId,
                offer: signalData,
                from: socket.id,
            });
        } else if (signalData.type === 'answer') {
            socket.emit('answer', {
                targetSocketId: remoteSocketId,
                answer: signalData,
                from: socket.id,
            });
        } else {
            // ICE candidates
            socket.emit('ice-candidate', {
                targetSocketId: remoteSocketId,
                candidate: signalData,
                from: socket.id,
            });
        }
    });

    // استقبال تيار الوسائط من المستخدم البعيد (صوت أو فيديو)
    peer.on('stream', (stream) => {
        handleRemoteMedia(stream, remoteSocketId, remoteUserName);
    });

    // استقبال مسار فيديو (مشاركة الشاشة) في حال تأخر الحدث
    peer.on('track', (track, stream) => {
        if (track.kind === 'video') {
            handleRemoteMedia(stream, remoteSocketId, remoteUserName);
        }
    });

    peer.on('error', (err) => {
        console.error(`خطأ في peer (${remoteSocketId}):`, err);
        showToast(`انقطع الاتصال مع ${remoteUserName}`, 'warning');
        cleanupPeer(remoteSocketId);
    });

    peer.on('close', () => {
        console.log(`اتصال peer مغلق: ${remoteSocketId}`);
        cleanupPeer(remoteSocketId);
    });

    peers[remoteSocketId] = peer;
    return peer;
}

/** معالجة التيار (صوت وفيديو) القادم من مستخدم بعيد */
function handleRemoteMedia(stream, remoteSocketId, remoteUserName) {
    console.log(`🔌 استقبال دفق وسائط من: ${remoteUserName} (${remoteSocketId})`);

    // 1. التعامل مع الصوت
    if (stream.getAudioTracks().length > 0) {
        let audio = document.getElementById(`audio-${remoteSocketId}`);
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = `audio-${remoteSocketId}`;
            audio.autoplay = true;
            audio.playsInline = true;
            audioContainer.appendChild(audio);
        }
        if (audio.srcObject !== stream) {
            audio.srcObject = stream;
        }
    }

    // 2. التعامل مع الفيديو (مشاركة الشاشة)
    if (stream.getVideoTracks().length > 0) {
        console.log(`🖥️ دفق فيديو (مشاركة شاشة) مكتشف من: ${remoteUserName}`);
        
        remoteScreenVideo.srcObject = stream;
        screenSharerName.textContent = remoteUserName;
        screenArea.classList.remove('hidden');
        updateParticipantScreenState(remoteSocketId, true);

        // التأكد من تشغل الفيديو (مهم ببعض المتصفحات)
        remoteScreenVideo.play().catch(e => console.warn('تعذر تشغيل الفيديو تلقائياً:', e));

        const videoTrack = stream.getVideoTracks()[0];
        videoTrack.onended = () => {
            if (remoteScreenVideo.srcObject === stream) {
                screenArea.classList.add('hidden');
                remoteScreenVideo.srcObject = null;
                updateParticipantScreenState(remoteSocketId, false);
            }
        };
    }
}

/** تنظيف اتصال peer محدد */
function cleanupPeer(socketId) {
    if (peers[socketId]) {
        try { peers[socketId].destroy(); } catch (e) { /* تجاهل */ }
        delete peers[socketId];
    }
    // إزالة عنصر الصوت
    const audio = document.getElementById(`audio-${socketId}`);
    if (audio) audio.remove();
}

// ═══════════════════════════════════════════════════════
// أحداث Socket.io
// ═══════════════════════════════════════════════════════

/** قائمة المستخدمين الموجودين عند الانضمام */
socket.on('existing-users', (users) => {
    users.forEach((user) => {
        addParticipantCard(user.socketId, user);
        // إنشاء اتصال peer مع كل مستخدم موجود (نحن المبادرون)
        createPeer(user.socketId, true, user.userId, user.userName);
    });
});

/** مستخدم جديد انضم إلى الغرفة */
socket.on('user-connected', ({ userId, userName, socketId: remoteSocketId }) => {
    showToast(`${userName} انضم إلى الغرفة`, 'success');
    addParticipantCard(remoteSocketId, { userId, userName });
    // المستخدم الجديد هو المبادر، لكننا لسنا كذلك هنا - ننتظر الـ offer
    // simple-peer سيُنشئ الـ peer غير المبادر عند استقبال offer
});

/** استقبال Offer */
socket.on('offer', ({ offer, from }) => {
    // إنشاء peer غير مبادر (نحن نرد على offer)
    const participant = participants[from];
    const remoteUserName = participant ? participant.userName : 'مستخدم';
    const remoteUserId = participant ? participant.userId : from;

    let peer = peers[from];
    if (!peer) {
        peer = createPeer(from, false, remoteUserId, remoteUserName);
    }
    peer.signal(offer);
});

/** استقبال Answer */
socket.on('answer', ({ answer, from }) => {
    const peer = peers[from];
    if (peer) {
        peer.signal(answer);
    }
});

/** استقبال ICE candidate */
socket.on('ice-candidate', ({ candidate, from }) => {
    const peer = peers[from];
    if (peer) {
        try { peer.signal(candidate); } catch (e) { /* تجاهل ICE stale */ }
    }
});

/** مستخدم غادر */
socket.on('user-disconnected', ({ userId, socketId: remoteSocketId }) => {
    const participant = participants[remoteSocketId];
    const name = participant ? participant.userName : 'مستخدم';
    showToast(`${name} غادر الغرفة`, 'warning');
    cleanupPeer(remoteSocketId);
    removeParticipantCard(remoteSocketId);

    // إخفاء منطقة الشاشة إذا كان المغادر يشاركها
    if (participant && participant.isSharing) {
        screenArea.classList.add('hidden');
        remoteScreenVideo.srcObject = null;
    }
});

/** استقبال حالة التحدث من مستخدم بعيد */
socket.on('peer-toggle-speaking', ({ socketId, isSpeaking }) => {
    toggleSpeakingUI(socketId, isSpeaking);
});

/** تحديث حالة مشاركة الشاشة من مستخدم بعيد */
socket.on('peer-toggle-screen', ({ userId, isSharing: shareState }) => {
    // البحث عن socketId للمستخدم عبر userId
    const socketId = Object.keys(participants).find(
        (sid) => participants[sid].userId === userId
    );
    if (socketId) {
        updateParticipantScreenState(socketId, shareState);
        if (!shareState) {
            screenArea.classList.add('hidden');
            remoteScreenVideo.srcObject = null;
        }
    }
});

// ═══════════════════════════════════════════════════════
// الانضمام إلى الغرفة
// ═══════════════════════════════════════════════════════

async function joinRoom(roomId) {
    // التأكد من اتصال السوكيت أولاً لضمان توفر socket.id
    if (!socket.connected) {
        console.log('⏳ في انتظار اتصال الخادم...');
        await new Promise(resolve => {
            socket.once('connect', resolve);
            // إذا كان متصلاً بالفعل صدفةً
            if (socket.connected) resolve();
        });
    }

    currentRoomId = roomId;

    // إظهار صفحة الغرفة
    homePage.classList.add('hidden');
    roomPage.classList.remove('hidden');
    roomIdDisplay.textContent = roomId;

    // تحديث عنوان الصفحة
    document.title = `غرفة ${roomId} | صوتي`;

    // الحصول على الميكروفون
    const audioOk = await getLocalAudio();
    if (!audioOk) {
        showToast('سيتم الانضمام بدون صوت', 'warning');
    }

    // إضافة نفسنا للقائمة (الآن نضمن أن socket.id موجود)
    addParticipantCard(socket.id, { userId: myUserId, userName: myUserName }, true);

    // إرسال طلب الانضمام للخادم
    socket.emit('join-room', {
        roomId,
        userId: myUserId,
        userName: myUserName,
    });

    lucide.createIcons();
}

// ═══════════════════════════════════════════════════════
// مشاركة الشاشة
// ═══════════════════════════════════════════════════════

async function startScreenShare() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always' },
            audio: false,
        });

        localScreenTrack = screenStream.getVideoTracks()[0];
        isSharing = true;

        // تحديث زر مشاركة الشاشة
        screenBtn.setAttribute('data-sharing', 'true');
        screenBtn.classList.add('bg-white', 'text-black');
        screenBtn.querySelector('.control-icon').outerHTML = '<i data-lucide="x-circle" class="w-5 h-5 control-icon"></i>';
        screenBtn.querySelector('.control-label').textContent = 'إيقاف';
        lucide.createIcons();

        // إضافة مسار الفيديو إلى جميع اتصالات peer الموجودة
        Object.values(peers).forEach((peer) => {
            try {
                peer.addTrack(localScreenTrack, screenStream);
            } catch (e) {
                console.warn('تعذر إضافة مسار الشاشة:', e);
            }
        });

        // إعلام الخادم
        socket.emit('toggle-screen', {
            roomId: currentRoomId,
            userId: myUserId,
            isSharing: true,
        });

        showToast('بدأت مشاركة الشاشة', 'success');

        // ── عرض الشاشة المشتركة للشخص نفسه ──
        remoteScreenVideo.srcObject = screenStream;
        screenSharerName.textContent = 'أنت';
        screenArea.classList.remove('hidden');

        // عند إيقاف المشاركة من المتصفح
        localScreenTrack.onended = () => {
            stopScreenShare();
        };
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            showToast('تم إلغاء مشاركة الشاشة', 'info');
        } else if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            showError('مشاركة الشاشة غير مدعومة', 'عذراً، متصفحك أو جهازك لا يدعم مشاركة الشاشة. هذه الخاصية تتطلب عادةً متصفحاً على جهاز كمبيوتر.');
        } else {
            showError('خطأ في مشاركة الشاشة', err.message);
        }
    }
}

function stopScreenShare() {
    if (!isSharing) return;
    isSharing = false;

    // إيقاف المسار
    if (localScreenTrack) {
        localScreenTrack.stop();

        // إزالة المسار من جميع الـ peers
        Object.values(peers).forEach((peer) => {
            try {
                peer.removeTrack(localScreenTrack, screenStream);
            } catch (e) { /* تجاهل */ }
        });

        localScreenTrack = null;
    }

    if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
        screenStream = null;
    }

    // ── إخفاء الفيديو المحلي للشاشة ──
    if (remoteScreenVideo.srcObject === screenStream || screenSharerName.textContent === 'أنت') {
        remoteScreenVideo.srcObject = null;
        screenArea.classList.add('hidden');
    }

    // تحديث الواجهة
    screenBtn.setAttribute('data-sharing', 'false');
    screenBtn.classList.remove('bg-white', 'text-black');
    screenBtn.querySelector('.control-icon').outerHTML = '<i data-lucide="monitor" class="w-5 h-5 control-icon"></i>';
    screenBtn.querySelector('.control-label').textContent = 'مشاركة';
    lucide.createIcons();

    // إعلام الخادم
    socket.emit('toggle-screen', {
        roomId: currentRoomId,
        userId: myUserId,
        isSharing: false,
    });

    showToast('تم إيقاف مشاركة الشاشة', 'info');
}

// ═══════════════════════════════════════════════════════
// إجراءات المستخدم
// ═══════════════════════════════════════════════════════

/** إنشاء غرفة جديدة */
createRoomBtn.addEventListener('click', () => {
    const roomId = generateRoomId();
    window.history.pushState({}, '', `/room/${roomId}`);
    joinRoom(roomId);
});

/** الانضمام عبر رابط مكتوب */
joinBtn.addEventListener('click', () => {
    const input = joinLinkInput.value.trim();
    if (!input) {
        showToast('يرجى إدخال رابط الغرفة', 'warning');
        return;
    }

    let roomId;
    try {
        // محاولة استخراج roomId من URL كامل أو من معرف مباشر
        if (input.startsWith('http')) {
            const url = new URL(input);
            const match = url.pathname.match(/\/room\/([a-zA-Z0-9_-]+)/);
            roomId = match ? match[1] : null;
        } else {
            // إدخال مباشر للمعرف
            roomId = input.replace(/^\/room\//, '');
        }
    } catch {
        roomId = input;
    }

    if (!roomId) {
        showToast('رابط الغرفة غير صحيح', 'error');
        return;
    }

    window.history.pushState({}, '', `/room/${roomId}`);
    joinRoom(roomId);
});

/** الضغط Enter في حقل الرابط */
joinLinkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
});

/** نسخ رابط الغرفة */
copyLinkBtn.addEventListener('click', async () => {
    const url = window.location.href;
    try {
        await navigator.clipboard.writeText(url);
        showToast('تم نسخ الرابط بنجاح', 'success');
        const icon = copyLinkBtn.querySelector('i');
        icon.outerHTML = '<i data-lucide="check-circle" class="w-5 h-5"></i>';
        lucide.createIcons();
        setTimeout(() => {
            copyLinkBtn.querySelector('i').outerHTML = '<i data-lucide="copy" class="w-5 h-5 text-white"></i>';
            lucide.createIcons();
        }, 2000);
    } catch {
        // Fallback للمتصفحات القديمة
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
        showToast('تم نسخ الرابط!', 'success');
    }
});

/** كتم / رفع الصوت */
muteBtn.addEventListener('click', () => {
    if (!localStream) {
        showToast('لا يوجد ميكروفون نشط', 'warning');
        return;
    }

    isMuted = !isMuted;
    localStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
    });

    muteBtn.setAttribute('data-muted', isMuted.toString());

    const icon = muteBtn.querySelector('.control-icon');
    const label = muteBtn.querySelector('.control-label');

    if (isMuted) {
        muteBtn.classList.add('bg-red-500', 'text-white', 'border-red-500');
        icon.outerHTML = '<i data-lucide="mic-off" class="w-5 h-5 control-icon"></i>';
        label.textContent = 'رفع الكتم';
        showToast('تم كتم صوتك', 'info');
    } else {
        muteBtn.classList.remove('bg-red-500', 'text-white', 'border-red-500');
        icon.outerHTML = '<i data-lucide="mic" class="w-5 h-5 control-icon"></i>';
        label.textContent = 'كتم الصوت';
        showToast('تم رفع كتم صوتك', 'success');
    }
    lucide.createIcons();

    // تحديث بطاقة المشارك
    const myCard = document.getElementById(`card-${socket.id}`);
    if (myCard) {
        const muteIndicator = myCard.querySelector('.mute-indicator');
        if (isMuted) muteIndicator.classList.remove('hidden');
        else muteIndicator.classList.add('hidden');
    }
});

/** مشاركة / إيقاف الشاشة */
screenBtn.addEventListener('click', () => {
    if (isSharing) {
        stopScreenShare();
    } else {
        startScreenShare();
    }
});

  /** زر ملء الشاشة */
fullscreenBtn.addEventListener('click', () => {
    const icon = fullscreenBtn.querySelector('i');
    if (!document.fullscreenElement) {
        // الدخول لوضع الشاشة الكاملة
        const el = remoteScreenVideo;
        if (el.requestFullscreen) {
            el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
            el.webkitRequestFullscreen();
        } else if (el.mozRequestFullScreen) {
            el.mozRequestFullScreen();
        }
        icon.outerHTML = '<i id="fullscreen-icon" data-lucide="x-circle" class="w-5 h-5"></i>';
        lucide.createIcons();
    } else {
        // الخروج من وضع الشاشة الكاملة
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
        icon.outerHTML = '<i id="fullscreen-icon" data-lucide="maximize" class="w-5 h-5"></i>';
        lucide.createIcons();
    }
});

/** تحديث أيقونة الزر عند تغيير حالة Fullscreen */
document.addEventListener('fullscreenchange', () => {
    const icon = fullscreenBtn.querySelector('i');
    if (document.fullscreenElement) {
        icon.outerHTML = '<i id="fullscreen-icon" data-lucide="x-circle" class="w-5 h-5"></i>';
        fullscreenBtn.title = 'إلغاء ملء الشاشة';
    } else {
        icon.outerHTML = '<i id="fullscreen-icon" data-lucide="maximize" class="w-5 h-5"></i>';
        fullscreenBtn.title = 'ملء الشاشة';
    }
    lucide.createIcons();
});

/** الخروج من الغرفة */
leaveBtn.addEventListener('click', () => {
    leaveRoom();
});

/** الخروج من الغرفة */
function leaveRoom() {
    // إيقاف مشاركة الشاشة
    if (isSharing) stopScreenShare();

    // إيقاف الميكروفون
    if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
    }

    // تدمير جميع اتصالات peer
    Object.keys(peers).forEach(cleanupPeer);

    // إعلام الخادم
    socket.emit('leave-room', {
        roomId: currentRoomId,
        userId: myUserId,
    });

    // إعادة تهيئة الحالة
    currentRoomId = null;
    isMuted = false;
    isSharing = false;
    participantsGrid.innerHTML = '';
    audioContainer.innerHTML = '';
    screenArea.classList.add('hidden');
    muteBtn.setAttribute('data-muted', 'false');
    muteBtn.querySelector('.control-icon').outerHTML = '<i data-lucide="mic" class="w-6 h-6 control-icon"></i>';
    muteBtn.querySelector('.control-label').textContent = 'كتم الصوت';
    screenBtn.setAttribute('data-sharing', 'false');
    screenBtn.querySelector('.control-icon').outerHTML = '<i data-lucide="monitor" class="w-6 h-6 control-icon"></i>';
    screenBtn.querySelector('.control-label').textContent = 'مشاركة الشاشة';
    lucide.createIcons();
    Object.keys(participants).forEach((k) => delete participants[k]);

    // إيقاف اكتشاف الصوت
    if (speechInterval) clearInterval(speechInterval);
    if (audioContext) audioContext.close();
    
    // العودة للصفحة الرئيسية
    window.history.pushState({}, '', '/');
    document.title = 'اجتماع صوتي سريع';
    roomPage.classList.add('hidden');
    homePage.classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════
// تحميل الصفحة — التحقق من الرابط
// ═══════════════════════════════════════════════════════

(function init() {
    const roomId = getRoomIdFromURL();
    if (roomId) {
        joinRoom(roomId);
    }
    lucide.createIcons();
})();

// التعامل مع زر الرجوع في المتصفح
window.addEventListener('popstate', () => {
    const roomId = getRoomIdFromURL();
    if (!roomId && currentRoomId) {
        leaveRoom();
    } else if (roomId && !currentRoomId) {
        joinRoom(roomId);
    }
});
