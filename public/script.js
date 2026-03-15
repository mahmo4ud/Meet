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
let myUserId = localStorage.getItem('souti_userId');
if (!myUserId) {
    myUserId = generateUserId();
    localStorage.setItem('souti_userId', myUserId);
}

let myUserName = localStorage.getItem('souti_userName') || '';
let mySpecialty = localStorage.getItem('souti_userJob') || ''; // تخصص المستخدم [NEW]
let myProfilePic = localStorage.getItem('souti_userPic') || ''; // صورة المستخدم [NEW]
let meetingName = '';           // اسم الاجتماع [NEW]
let currentRoomId = null;
let isMuted = false;
let isSharing = false;

// المشاركون: { [socketId]: { userId, userName, specialty, isMuted, isSharing, isSpeaking } }
const participants = {};

// إعدادات الصفحات والجرد [NEW]
let currentPage = 0;
const columns = 5;
const rows = 4;
const itemsPerPage = columns * rows; // 20

// لاكتشاف الصوت
let audioContext = null;
let analyser = null;
let microphone = null;
let speechInterval = null;

// عناصر الواجهة
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
const screenSharerAvatar = document.getElementById('screen-sharer-avatar');

// زر إغلاق العرض المكبر [NEW]
const closeScreenBtn = document.getElementById('close-screen-btn');

// عناصر المودال الجديدة [NEW]
const setupRoomModal = document.getElementById('setup-room-modal');
const setupRoomNameInput = document.getElementById('setup-room-name');
const setupRoomConfirmBtn = document.getElementById('setup-room-confirm');

const userSetupModal = document.getElementById('user-setup-modal');
const userSetupNameInput = document.getElementById('user-setup-name');
const userSetupJobInput = document.getElementById('user-setup-job');
const userSetupConfirmBtn = document.getElementById('user-setup-confirm');
const userSetupSkipBtn = document.getElementById('user-setup-skip');
const profileUpload = document.getElementById('profile-upload');
const profilePreview = document.getElementById('profile-preview');
const profilePicContainer = document.getElementById('profile-pic-container');

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
    const match = path.match(/^\/room\/([a-zA-Z0-9_-]+)\/?$/);
    return match ? match[1] : null;
}

/**
 * ضغط الصورة وتصغير حجمها لضمان سرعة المزامنة
 * @param {string} base64 - الصورة بصيغة Base64
 * @param {number} maxWidth - أقصى عرض
 * @param {number} maxHeight - أقصى ارتفاع
 * @returns {Promise<string>} - الصورة مضغوطة
 */
async function compressImage(base64, maxWidth = 200, maxHeight = 200) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.7)); // جودة 70% بصيغة JPEG
        };
    });
}

/** توليد roomId عشوائي */
function generateRoomId() {
    return Math.random().toString(36).slice(2, 9);
}

// ── إعدادات صورة الملف الشخصي ──
if (profilePicContainer) {
    profilePicContainer.addEventListener('click', () => profileUpload.click());

    profileUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const originalBase64 = event.target.result;
                // ضغط الصورة قبل حفظها أو إرسالها
                myProfilePic = await compressImage(originalBase64);
                profilePreview.innerHTML = `<img src="${myProfilePic}" class="w-full h-full object-cover rounded-full aspect-square shadow-xl">`;
                localStorage.setItem('souti_userPic', myProfilePic);
            };
            reader.readAsDataURL(file);
        }
    });

    // تحميل الصورة من الكاش إذا وجدت
    if (myProfilePic) {
        profilePreview.innerHTML = `<img src="${myProfilePic}" class="w-full h-full object-cover rounded-full aspect-square shadow-xl">`;
    }
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
    const participantKeys = Object.keys(participants);
    const count = participantKeys.length;
    participantCount.textContent = count;

    const isMobile = window.innerWidth < 768;
    const currentItemsPerPage = isMobile ? 8 : itemsPerPage;

    // إظهار/إخفاء أزرار التنقل
    const hasMultiplePages = count > currentItemsPerPage;
    const itemsToShow = hasMultiplePages ? currentItemsPerPage - 1 : currentItemsPerPage;
    const totalPages = Math.ceil(count / itemsToShow);

    document.getElementById('prev-page-btn').classList.toggle('hidden', currentPage === 0);
    document.getElementById('next-page-btn').classList.toggle('hidden', currentPage >= totalPages - 1);

    // حساب التوزيع الديناميكي للتصميم "المرن"
    const startIdx = currentPage * itemsToShow;
    const endIdx = startIdx + itemsToShow;
    const pageParticipantsCount = participantKeys.slice(startIdx, endIdx).length;
    const showOverflow = count > endIdx;
    const displayedTilesCount = pageParticipantsCount + (showOverflow ? 1 : 0);

    participantsGrid.className = 'flex-1 grid gap-3 md:gap-4 lg:gap-6 items-center justify-center content-center w-full h-full mx-auto transition-all duration-500 p-2 md:p-4 lg:p-6';

    if (isMobile) {
        participantsGrid.style.gridTemplateColumns = displayedTilesCount === 1 ? '1fr' : 'repeat(2, 1fr)';
        participantsGrid.style.gridTemplateRows = 'auto';
        participantsGrid.style.maxWidth = '100%';
    } else {
        // منطق مرن لعدد العناصر في الصفحة الحالية
        let dynamicCols = 1;
        let dynamicRows = 1;

        if (displayedTilesCount === 1) {
            dynamicCols = 1;
            participantsGrid.style.maxWidth = '800px';
        } else if (displayedTilesCount === 2) {
            dynamicCols = 2;
            participantsGrid.style.maxWidth = '1200px';
        } else if (displayedTilesCount === 3) {
            dynamicCols = 3;
            participantsGrid.style.maxWidth = '1400px';
        } else if (displayedTilesCount === 4) {
            dynamicCols = 2;
            dynamicRows = 2;
            participantsGrid.style.maxWidth = '1000px';
        } else {
            // للتوزيع الأكبر، نستخدم الحد الأقصى المطلوب بناءً على عرض الشاشة
            const width = window.innerWidth;
            let maxCols = 5;
            if (width < 1024) maxCols = 3;
            else if (width < 1400) maxCols = 4;
            
            dynamicCols = Math.min(displayedTilesCount, maxCols);
            dynamicRows = Math.ceil(displayedTilesCount / dynamicCols);
            participantsGrid.style.maxWidth = width < 1024 ? '1000px' : '1400px';
        }

        participantsGrid.style.gridTemplateColumns = `repeat(${dynamicCols}, 1fr)`;
        participantsGrid.style.gridTemplateRows = `repeat(${dynamicRows}, auto)`;
    }

    renderGrid();
}

/** رندر الشبكة بناءً على الصفحة الحالية */
function renderGrid() {
    const participantKeys = Object.keys(participants);
    const totalCount = participantKeys.length;

    // مسح الشبكة الحالية
    participantsGrid.innerHTML = '';

    // إذا كنت تستخدم صفحات، فكل صفحة تعرض (itemsPerPage - 1) إذا كان هناك المزيد
    const isMobile = window.innerWidth < 768;
    const currentItemsPerPage = isMobile ? 8 : itemsPerPage;
    const hasMultiplePages = totalCount > currentItemsPerPage;
    const itemsToShow = hasMultiplePages ? currentItemsPerPage - 1 : currentItemsPerPage;

    const startIdx = currentPage * itemsToShow;
    const endIdx = startIdx + itemsToShow;

    // تحديد المشاركين للصفحة الحالية
    const pageParticipants = participantKeys.slice(startIdx, endIdx);

    pageParticipants.forEach((socketId) => {
        const data = participants[socketId];
        renderParticipantTile(socketId, data, data.isMe);
    });

    // إضافة كارد "المزيد" إذا كان هناك بقية
    if (totalCount > endIdx) {
        renderMoreCard(totalCount - endIdx);
    }

    lucide.createIcons();
}

/** رندر كارد مشارك منفرد */
function renderParticipantTile(socketId, data, isMe = false) {
    const tile = document.createElement('div');
    tile.className = `participant-tile relative min-h-[120px] md:aspect-video bg-brand-card border border-brand-border rounded-2xl md:rounded-3xl flex flex-col items-center justify-center animate-scale-in group overflow-hidden shadow-2xl transition-all duration-500 ${isMe ? 'ring-1 ring-white/10' : ''}`;
    tile.id = `card-${socketId}`;

    tile.innerHTML = `
    <!-- Blurred Background [NEW] -->
    <div class="participant-bg absolute inset-0 z-0 overflow-hidden ${data.profilePic ? '' : 'hidden'}">
      <img src="${data.profilePic}" class="w-full h-full object-cover blur-2xl opacity-40 scale-125">
      <div class="absolute inset-0 bg-black/20"></div>
    </div>

    <div class="participant-avatar w-20 h-20 md:w-24 md:h-24 lg:w-32 lg:h-32 rounded-full bg-white/10 flex items-center justify-center font-bold text-xl md:text-2xl lg:text-4xl text-white border-2 border-white/20 relative z-10 transition-transform duration-500 group-hover:scale-110 shadow-[0_0_50px_rgba(0,0,0,0.5)] aspect-square ${data.isSharing ? 'hidden' : ''}">
      ${data.profilePic ? `<img src="${data.profilePic}" class="w-full h-full object-cover rounded-full aspect-square">` : getInitials(data.userName)}
      <div class="speaking-ring absolute inset-0 rounded-full border-4 border-white/40 ${data.isSpeaking ? '' : 'hidden'}"></div>
    </div>
    
    <video class="participant-screen absolute inset-0 w-full h-full object-contain bg-black ${data.isSharing ? '' : 'hidden'} z-20" autoplay playsinline muted></video>

    <button class="expand-screen-btn absolute top-2 left-2 z-40 w-7 h-7 bg-black/60 hover:bg-white hover:text-black rounded-lg border border-white/10 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 ${data.isSharing ? '' : 'hidden'}">
      <i data-lucide="maximize" class="w-3.5 h-3.5"></i>
    </button>
    
    <div class="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent opacity-50"></div>

    <div class="absolute bottom-2 left-2 right-2 md:bottom-4 md:left-4 md:right-4 z-30 flex items-center justify-between pointer-events-none">
      <div class="flex flex-col gap-0 max-w-[70%] md:max-w-none">
        <div class="flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2 py-0.5 md:px-2 md:py-1 rounded-full border border-white/5 w-fit">
          <span class="participant-name font-bold text-[9px] md:text-xs text-white truncate max-w-[50px] md:max-w-none">${data.userName}</span>
          ${isMe ? '<span class="text-[6px] md:text-[7px] bg-white text-black px-1 py-0 rounded-md font-black uppercase shrink-0">أنت</span>' : ''}
        </div>
        ${data.specialty ? `<span class="participant-specialty text-[7px] md:text-[9px] text-brand-muted px-2 truncate">${data.specialty}</span>` : ''}
      </div>

      <div class="flex items-center gap-1">
        <span class="mute-indicator ${data.isMuted ? '' : 'hidden'} w-5 h-5 md:w-6 md:h-6 bg-red-500/20 backdrop-blur-md border border-red-500/30 rounded-full flex items-center justify-center text-red-500 shadow-lg">
          <i data-lucide="mic-off" class="w-2.5 h-2.5 md:w-3 md:h-3"></i>
        </span>
        <span class="sharing-indicator ${data.isSharing ? '' : 'hidden'} w-5 h-5 md:w-6 md:h-6 bg-green-500/20 backdrop-blur-md border border-green-500/30 rounded-full flex items-center justify-center text-green-500 shadow-lg">
          <i data-lucide="monitor" class="w-2.5 h-2.5 md:w-3 md:h-3"></i>
        </span>
      </div>
    </div>
  `;

    participantsGrid.appendChild(tile);

    // ربط الستريم إذا كان متاحاً (خاصة عند إعادة الرندر بسبب التنقل بين الصفحات)
    if (data.isSharing && data.screenStream) {
        const video = tile.querySelector('.participant-screen');
        if (video) {
            video.srcObject = data.screenStream;
            video.play().catch(() => { });
        }
    }

    const expandBtn = tile.querySelector('.expand-screen-btn');
    expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const video = tile.querySelector('.participant-screen');
        if (video && video.srcObject) {
            expandScreenView(video.srcObject, data.userName, data.profilePic);
        }
    });
}

/** رندر كارد "المزيد" */
function renderMoreCard(remainingCount) {
    const tile = document.createElement('div');
    tile.className = "participant-tile relative aspect-video bg-brand-border/20 border border-brand-border rounded-3xl flex flex-col items-center justify-center animate-scale-in group overflow-hidden shadow-2xl transition-all duration-500 hover:bg-brand-border/40 cursor-pointer";

    tile.innerHTML = `
        <div class="text-4xl font-black text-white">+${remainingCount}</div>
        <div class="text-xs font-bold text-brand-muted mt-2">عضو إضافي</div>
    `;

    tile.addEventListener('click', () => {
        currentPage++;
        updateParticipantCount();
    });

    participantsGrid.appendChild(tile);
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
    if (participants[socketId]) return;
    participants[socketId] = { ...data, isMe, isMuted: false, isSharing: false, isSpeaking: false };
    updateParticipantCount();
}

/** إزالة مشارك من القائمة */
function removeParticipantCard(socketId) {
    delete participants[socketId];
    updateParticipantCount();
}

/** تحديث حالة مشاركة الشاشة لمشارك */
function updateParticipantScreenState(socketId, isShareState) {
    if (participants[socketId]) {
        participants[socketId].isSharing = isShareState;
        updateParticipantCount();
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
    if (participants[socketId]) {
        participants[socketId].isSpeaking = isSpeaking;

        const card = document.getElementById(`card-${socketId}`);
        if (card) {
            const ring = card.querySelector('.speaking-ring');
            if (ring) {
                if (isSpeaking) ring.classList.remove('hidden');
                else ring.classList.add('hidden');
            }
        }
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
 * @param {string} remoteSpecialty - تخصص المستخدم البعيد
 * @param {string} remoteProfilePic - صورة المستخدم البعيد
 */
function createPeer(remoteSocketId, initiator, remoteUserId, remoteUserName, remoteSpecialty, remoteProfilePic) {
    if (peers[remoteSocketId]) {
        // إذا كان الاتصال موجوداً بالفعل، لا تدمره إلا في حالة الضرورة القصوى (مثل إعادة التحميل)
        // لكن هنا، في الغالب نستخدم التبادل لإعادة التفاوض
    }

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

    // إذا كنا نشارك شاشة بالفعل، أضفها إلى الـ peer الجديد
    if (isSharing && localScreenTrack) {
        try {
            peer.addTrack(localScreenTrack, screenStream);
        } catch (e) {
            console.warn('Failed to add track to new peer:', e);
        }
    }

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

    // استقبال مسار فيديو (مشاركة الشاشة) في حال تأخر الحدث
    peer.on('track', (track, stream) => {
        console.log(`📡 مسار جديد (${track.kind}) من: ${remoteUserName}`);
        handleRemoteMedia(stream, remoteSocketId, remoteUserName);
    });

    // استقبال تيار الوسائط من المستخدم البعيد
    peer.on('stream', (stream) => {
        handleRemoteMedia(stream, remoteSocketId, remoteUserName);
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
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length > 0) {
        console.log(`🖥️ دفق فيديو (${videoTracks.length} مسار) من: ${remoteUserName}`);

        const card = document.getElementById(`card-${remoteSocketId}`);
        if (card) {
            const video = card.querySelector('.participant-screen');
            if (video) {
                if (video.srcObject !== stream) {
                    video.srcObject = stream;
                }

                // حفظ الستريم في بيانات المشارك للتمكن من إعادة ربطه عند الرندر
                if (participants[remoteSocketId]) {
                    participants[remoteSocketId].screenStream = stream;
                }

                // التأكد من تشغيل الفيديو فور تحميله
                video.muted = true; // فيديو المشاركة صامت دائماً
                video.play().catch(e => {
                    console.warn('تعذر تشغيل الفيديو، تجربة التشغيل بعد التفاعل:', e);
                    // في بعض المتصفحات نحتاج لتفاعل لتشغيل الفيديو
                });

                updateParticipantScreenState(remoteSocketId, true);
            }
        }

        videoTracks.forEach(track => {
            track.onended = () => {
                console.log(`🛑 توقف دفق الفيديو من: ${remoteUserName}`);
                updateParticipantScreenState(remoteSocketId, false);
            };
        });
    }
}

/** عرض الشاشة بشكل مكبّر */
function expandScreenView(stream, name, profilePic) {
    remoteScreenVideo.srcObject = stream;
    screenSharerName.textContent = name;
    
    // تحديث صورة الشخص الذي يشارك الشاشة
    if (screenSharerAvatar) {
        if (profilePic) {
            screenSharerAvatar.innerHTML = `<img src="${profilePic}" class="w-full h-full object-cover">`;
        } else {
            screenSharerAvatar.innerHTML = `<div class="bg-white/10 w-full h-full flex items-center justify-center">${getInitials(name)}</div>`;
        }
    }

    screenArea.classList.remove('hidden');
    remoteScreenVideo.play().catch(e => console.warn('تعذر تشغيل الفيديو المكبر:', e));
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
        createPeer(user.socketId, true, user.userId, user.userName, user.specialty, user.profilePic);
    });
});

/** مستخدم جديد انضم إلى الغرفة */
socket.on('user-connected', ({ userId, userName, specialty, profilePic, socketId: remoteSocketId }) => {
    showToast(`${userName} انضم إلى الغرفة`, 'success');
    addParticipantCard(remoteSocketId, { userId, userName, specialty, profilePic });
    // المستخدم الجديد هو المبادر، لكننا لسنا كذلك هنا - ننتظر الـ offer
});

/** استقبال Offer */
socket.on('offer', ({ offer, from }) => {
    // إنشاء peer غير مبادر (نحن نرد على offer)
    const participant = participants[from];
    const remoteUserName = participant ? participant.userName : 'مستخدم';
    const remoteUserId = participant ? participant.userId : from;
    const remoteSpecialty = participant ? participant.specialty : '';
    const remoteProfilePic = participant ? participant.profilePic : '';
    
    let peer = peers[from];
    if (!peer) {
        peer = createPeer(from, false, remoteUserId, remoteUserName, remoteSpecialty, remoteProfilePic);
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
    // التأكد من اتصال السوكيت أولاً
    if (!socket.connected) {
        await new Promise(resolve => {
            socket.once('connect', resolve);
            if (socket.connected) resolve();
        });
    }

    currentRoomId = roomId;

    // طلب معلومات الغرفة (الاسم) من الخادم
    socket.emit('get-room-info', roomId);
    socket.once('room-info', (info) => {
        if (info && info.meetingName) {
            meetingName = info.meetingName;
            const displayName = document.getElementById('setup-room-display-name');
            if (displayName) {
                displayName.textContent = `انضمام إلى: ${meetingName}`;
                displayName.classList.remove('hidden');
            }
            // تحديث اسم الغرفة في الصفحة الرئيسية إذا لزم الأمر
            roomIdDisplay.textContent = meetingName;
        }
    });

    // إذا كانت البيانات موجودة في الكاش، ننضم مباشرة
    if (!myUserName) {
        // إظهار مودال إعداد المستخدم قبل الدخول
        userSetupModal.classList.remove('hidden');
        userSetupNameInput.value = '';
        userSetupNameInput.focus();

        // ننتظر ضغط المستخدم على تأكيد أو تخطي
        const userData = await new Promise((resolve) => {
            const handleConfirm = () => {
                const name = userSetupNameInput.value.trim();
                const job = userSetupJobInput.value.trim();
                if (!name) {
                    showToast('يرجى إدخال اسمك', 'warning');
                    return;
                }
                cleanup();
                localStorage.setItem('souti_userName', name);
                localStorage.setItem('souti_userJob', job);
                resolve({ name, job });
            };

            const handleSkip = () => {
                // اسم ضيف عشوائي (ضيف 1، ضيف 2...)
                const guestNum = Math.floor(Math.random() * 1000);
                const name = `ضيف ${guestNum}`;
                const job = 'زائر';
                cleanup();
                
                // حفظ للضيف في localStorage ليتخطى المودال عند الريفرش
                localStorage.setItem('souti_userName', name);
                localStorage.setItem('souti_userJob', job);
                
                resolve({ name, job });
            };

            const cleanup = () => {
                userSetupConfirmBtn.removeEventListener('click', handleConfirm);
                userSetupSkipBtn.removeEventListener('click', handleSkip);
                userSetupModal.classList.add('hidden');
            };

            userSetupConfirmBtn.addEventListener('click', handleConfirm);
            userSetupSkipBtn.addEventListener('click', handleSkip);

            // Enter key support
            userSetupJobInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleConfirm();
            });
        });

        myUserName = userData.name;
        mySpecialty = userData.job;
    }

    // إظهار صفحة الغرفة
    homePage.classList.add('hidden');
    roomPage.classList.remove('hidden');
    roomIdDisplay.textContent = meetingName || roomId;

    // تحديث عنوان الصفحة
    document.title = `${meetingName || roomId} | اجتماع`;

    // الحصول على الميكروفون
    const audioOk = await getLocalAudio();
    if (!audioOk) {
        showToast('سيتم الانضمام بدون صوت', 'warning');
    }

    // إضافة نفسنا للقائمة
    addParticipantCard(socket.id, {
        userId: myUserId,
        userName: myUserName,
        specialty: mySpecialty,
        profilePic: myProfilePic
    }, true);

    // إرسال طلب الانضمام للخادم
    socket.emit('join-room', {
        roomId,
        userId: myUserId,
        userName: myUserName,
        specialty: mySpecialty,
        profilePic: myProfilePic,
        meetingName: meetingName // اختياري: لإخطار الآخرين باسم الغرفة إذا أردنا
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

        // ── عرض الشاشة المشتركة للشخص نفسه داخل الكارد ──
        const myCard = document.getElementById(`card-${socket.id}`);
        if (myCard) {
            const video = myCard.querySelector('.participant-screen');
            if (video) {
                video.srcObject = screenStream;
                video.onloadedmetadata = () => video.play().catch(() => { });
                updateParticipantScreenState(socket.id, true);
            }
        }

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
        if (participants[socket.id]) {
            participants[socket.id].screenStream = null;
        }

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
    updateParticipantScreenState(socket.id, false);

    // تحديث الواجهة
    // تحديث الواجهة
    screenBtn.setAttribute('data-sharing', 'false');
    screenBtn.classList.remove('bg-white', 'text-black');
    screenBtn.querySelector('.control-icon').outerHTML = '<i data-lucide="monitor" class="w-5 h-5 control-icon"></i>';
    screenBtn.querySelector('.control-label').textContent = 'مشاركة';
    lucide.createIcons();

    isSharing = false;

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

/** إنشاء غرفة جديدة - إظهار مودال اسم الميت */
createRoomBtn.addEventListener('click', () => {
    setupRoomModal.classList.remove('hidden');
    setupRoomNameInput.focus();
});

/** تأكيد اسم الغرفة والبدء */
setupRoomConfirmBtn.addEventListener('click', () => {
    const name = setupRoomNameInput.value.trim();
    if (!name) {
        showToast('يرجى إدخال اسم للاجتماع', 'warning');
        return;
    }
    meetingName = name;
    setupRoomModal.classList.add('hidden');

    // إنشاء المعرف والانتقال لمودال البيانات الشخصية
    const roomId = generateRoomId();
    window.history.pushState({}, '', `/room/${roomId}`);
    
    // إرسال بيانات الغرفة للخادم فوراً ليحفظ الاسم
    socket.emit('create-room', { roomId, meetingName });
    
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
        if (input.startsWith('http')) {
            const url = new URL(input);
            const match = url.pathname.match(/\/room\/([a-zA-Z0-9_-]+)/);
            roomId = match ? match[1] : null;
        } else {
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

/** الضغط Enter في حقول الإنشاء */
setupRoomNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') setupRoomConfirmBtn.click();
});

/** الضغط Enter في حقل الرابط */
joinLinkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
});

/** نسخ رابط الغرفة */
/** إغلاق العرض المكبر للمشاركة */
closeScreenBtn.addEventListener('click', () => {
    screenArea.classList.add('hidden');
    remoteScreenVideo.srcObject = null;
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
// أزرار التنقل (Pagination)
// ═══════════════════════════════════════════════════════

document.getElementById('prev-page-btn').addEventListener('click', () => {
    if (currentPage > 0) {
        currentPage--;
        updateParticipantCount();
    }
});

document.getElementById('next-page-btn').addEventListener('click', () => {
    const totalCount = Object.keys(participants).length;
    const isMobile = window.innerWidth < 768;
    const currentItemsPerPage = isMobile ? 8 : itemsPerPage;
    const hasMultiplePages = totalCount > currentItemsPerPage;
    const itemsToShow = hasMultiplePages ? currentItemsPerPage - 1 : currentItemsPerPage;
    const totalPages = Math.ceil(totalCount / itemsToShow);

    if (currentPage < totalPages - 1) {
        currentPage++;
        updateParticipantCount();
    }
});

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
