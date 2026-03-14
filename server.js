const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// تقديم الملفات الثابتة من مجلد public
app.use(express.static(path.join(__dirname, 'public')));

// توجيه جميع المسارات إلى index.html لدعم روابط الغرف
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// تخزين الغرف النشطة: key = roomId, value = Map<socketId, userData>
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`✅ مستخدم متصل: ${socket.id}`);

  // ─── إنشاء غرفة جديدة ───────────────────────────────────────────────────────
  socket.on('create-room', (roomId) => {
    rooms.set(roomId, new Map());
    console.log(`🏠 غرفة جديدة: ${roomId}`);
    socket.emit('room-created', roomId);
  });

  // ─── الانضمام إلى غرفة ─────────────────────────────────────────────────────
  socket.on('join-room', ({ roomId, userId, userName }) => {
    // إنشاء الغرفة إذا لم تكن موجودة
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }

    const room = rooms.get(roomId);

    // الحصول على قائمة المشاركين الموجودين قبل الانضمام
    const existingUsers = Array.from(room.values());

    // إضافة المستخدم الجديد
    room.set(socket.id, { userId, userName, socketId: socket.id });

    // الانضمام إلى غرفة Socket.io
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userId = userId;
    socket.data.userName = userName;

    console.log(`👤 ${userName} انضم إلى الغرفة ${roomId}`);

    // إرسال قائمة المشاركين الموجودين للمستخدم الجديد
    socket.emit('existing-users', existingUsers);

    // إعلام الأعضاء الآخرين بمستخدم جديد
    socket.to(roomId).emit('user-connected', { userId, userName, socketId: socket.id });
  });

  // ─── إشارات WebRTC ──────────────────────────────────────────────────────────

  // إعادة توجيه Offer
  socket.on('offer', ({ targetSocketId, offer, from }) => {
    io.to(targetSocketId).emit('offer', { offer, from });
  });

  // إعادة توجيه Answer
  socket.on('answer', ({ targetSocketId, answer, from }) => {
    io.to(targetSocketId).emit('answer', { answer, from });
  });

  // إعادة توجيه ICE Candidates
  socket.on('ice-candidate', ({ targetSocketId, candidate, from }) => {
    io.to(targetSocketId).emit('ice-candidate', { candidate, from });
  });

  // ─── مشاركة الشاشة ─────────────────────────────────────────────────────────
  socket.on('toggle-screen', ({ roomId, userId, isSharing }) => {
    console.log(`🖥️ مشاركة شاشة: ${userId} في الغرفة ${roomId} (${isSharing ? 'بدأ' : 'توقف'})`);
    socket.to(roomId).emit('peer-toggle-screen', { userId, isSharing });
  });

  // ─── اكتشاف التحدث ──────────────────────────────────────────────────────────
  socket.on('toggle-speaking', ({ roomId, isSpeaking }) => {
    socket.to(roomId).emit('peer-toggle-speaking', { socketId: socket.id, isSpeaking });
  });

  // ─── مغادرة المستخدم ────────────────────────────────────────────────────────
  socket.on('leave-room', ({ roomId, userId }) => {
    handleUserLeave(socket, roomId, userId);
  });

  // ─── قطع الاتصال ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const userId = socket.data.userId;

    if (roomId) {
      handleUserLeave(socket, roomId, userId);
    }

    console.log(`❌ مستخدم قطع الاتصال: ${socket.id}`);
  });
});

// دالة مساعدة لمعالجة مغادرة المستخدم
function handleUserLeave(socket, roomId, userId) {
  if (!roomId || !rooms.has(roomId)) return;

  const room = rooms.get(roomId);
  room.delete(socket.id);

  // إعلام الأعضاء الآخرين
  socket.to(roomId).emit('user-disconnected', { userId, socketId: socket.id });

  // حذف الغرفة إذا كانت فارغة
  if (room.size === 0) {
    rooms.delete(roomId);
    console.log(`🗑️ تم حذف الغرفة الفارغة: ${roomId}`);
  }

  socket.leave(roomId);
}

server.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على: http://localhost:${PORT}`);
});
