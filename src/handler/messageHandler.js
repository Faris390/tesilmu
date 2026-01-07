// Fungsi untuk memproses dan merespon pesan
const handleMessage = async (sock, msg) => {
    // 1. Filter Pesan
    // Abaikan pesan dari status atau pesan dari bot itu sendiri
    if (msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;

    // Ambil konten teks pesan. Coba dari berbagai jenis pesan.
    const textMessage = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const chatId = msg.key.remoteJid; // ID Chat (nomor pribadi atau ID grup)
    
    // 2. Deteksi Konteks Chat
    const isGroup = chatId.endsWith('@g.us'); 
    const sender = msg.key.participant || chatId; // ID pengirim pesan
    const senderNumber = sender.split('@')[0];
    
    let groupMetadata;
    
    if (isGroup) {
        try {
            // Ambil data grup (nama, anggota, dll.)
            groupMetadata = await sock.groupMetadata(chatId);
            console.log(`[Pesan Masuk GROUP] Di Grup: ${groupMetadata.subject} | Dari: ${senderNumber} | Isi: "${textMessage}"`);
        } catch (e) {
            console.error("Gagal mengambil metadata grup:", e);
        }
    } else {
        console.log(`[Pesan Masuk PRIVATE] Dari: ${senderNumber} | Isi: "${textMessage}"`);
    }
    
    // 3. Logika Pemrosesan Perintah (Case-Insensitive)
    const lowerCaseMessage = textMessage.toLowerCase().trim();
    let replyText = '';

    // Perintah Umum (Berlaku di PC dan Grup)
    if (lowerCaseMessage === 'halo') {
        replyText = isGroup 
            ? `Halo semua di grup **${groupMetadata?.subject || 'ini'}**! Saya bot yang aktif.`
            : `Halo juga! Saya adalah bot pribadi Anda.`;
    } 
    
    // Perintah Khusus Grup
    else if (lowerCaseMessage === '!grupinfo' && isGroup) {
        if (groupMetadata) {
            const creationDate = new Date(groupMetadata.creation * 1000).toLocaleString('id-ID');
            replyText = `Informasi Grup:\n* Nama: ${groupMetadata.subject}\n* Dibuat: ${creationDate}\n* Jumlah Anggota: ${groupMetadata.participants.length}`;
        } else {
            replyText = 'Tidak dapat mengambil info grup saat ini.';
        }
    }

    // Perintah Bantuan
    else if (lowerCaseMessage === '!perintah') {
        replyText = `Daftar Perintah:\n* halo\n* !perintah\n* !siapa\n* !grupinfo (Khusus Grup)`;
    } 
    
    // Perintah Identitas
    else if (lowerCaseMessage === '!siapa') {
        replyText = `Nomor Anda: ${senderNumber}. Anda berada di ${isGroup ? 'Grup' : 'Chat Pribadi'}.`;
    }

    // 4. Balasan Default
    // Jika ada balasan yang terdefinisi, kirim. Jika tidak, bot akan diam (khususnya di Grup)
    if (replyText) {
        // Kirim Balasan (chatId akan otomatis mengirim ke grup atau ke chat pribadi)
        await sock.sendMessage(chatId, { text: replyText }, { quoted: msg });
        console.log(`[Pesan Keluar] Balasan: "${replyText.substring(0, 30)}..."`);
    } 
    // Catatan: Anda bisa menambahkan balasan default untuk PC di sini jika `replyText` kosong
    else if (!isGroup) {
        // Balasan default hanya untuk PC jika tidak ada perintah yang cocok
        // await sock.sendMessage(chatId, { text: 'Maaf, saya tidak mengerti perintah Anda. Coba !perintah.' }, { quoted: msg });
    }
};

module.exports = { handleMessage };
