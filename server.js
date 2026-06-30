const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Agar Express bisa membaca data JSON dan Form dari Frontend
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Konfigurasi tempat dan nama file yang di-upload oleh Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // File foto akan masuk ke folder uploads
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// =======================================================
// 1. KONEKSI KE DATABASE AIVEN (UPGRADED ANTI-ECONNRESET)
// =======================================================
const dbConfig = {
    host: "mysql-3ef31308-itaa.h.aivencloud.com",
    port: 21505,
    user: "avnadmin",
    password: "AVNS_KTS-uu7yNx2MenbhqpF", 
    database: "defaultdb",
    waitForConnections: true,
    connectionLimit: 15, // Ditambah sedikit slotnya agar aman pas refresh barengan
    queueLimit: 0,
    
    // --- SETTINGAN SAKTI PENYELAMAT TIMEOUT ---
    enableKeepAlive: true, 
    keepAliveInitialDelay: 10000, // Kirim sinyal ping otomatis ke cloud tiap 10 detik
    connectTimeout: 30000,
    acquireTimeout: 30000,
    
    ssl: {
        rejectUnauthorized: false // WAJIB untuk cloud
    }
};

let db = mysql.createPool(dbConfig);

// Fungsi pengawas untuk memantau jika ada error drop koneksi di background
function handleDisconnect() {
    db.getConnection((err, connection) => {
        if (err) {
            console.error('🔥 Gagal konek database Aiven. Mencoba lagi dalam 5 detik...', err.message);
            // Ganti pool lama dengan yang baru jika gagal total
            db = mysql.createPool(dbConfig);
            setTimeout(handleDisconnect, 5000);
            return;
        }
        console.log('✅ Database Aiven Cloud Terhubung Stabil & Siap Pakai (Anti-Badai)!');
        connection.release();
    });
}

handleDisconnect();

// Middleware untuk membaca folder "public" secara otomatis
app.use(express.static(path.join(__dirname, 'public')));
// Izinkan aplikasi membaca folder uploads secara publik
app.use('/uploads', express.static('uploads'));

// 2. JALUR UTAMA (Membuka index.html saat pertama kali diakses)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 🚀 API LOGIN
// ==========================================
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
        if (err) {
            console.error("Error saat login:", err);
            return res.status(500).json({ success: false, message: 'Server database error' });
        }

        if (results.length === 0) {
            return res.status(401).json({ success: false, message: 'Username atau password salah!' });
        }

        const user = results[0];

        if (password !== user.password) {
            return res.status(401).json({ success: false, message: 'Username atau password salah!' });
        }

        res.json({
            success: true,
            message: 'Login berhasil!',
            user: {
                id: user.id,
                nama: user.nama_lengkap,
                role: user.role
            }
        });
    });
});

// ==========================================
// 🚀 API REGISTER
// ==========================================
app.post('/api/register', (req, res) => {
    const { nama_lengkap, username, password } = req.body;
    const role = 'user'; 

    const sqlDaftar = 'INSERT INTO users (nama_lengkap, username, password, role) VALUES (?, ?, ?, ?)';
    
    db.query(sqlDaftar, [nama_lengkap, username, password, role], (err, result) => {
        if (err) {
            console.error("Gagal mendaftarkan user:", err);
            return res.status(500).json({ success: false, message: 'Gagal menyimpan ke database' });
        }
        res.json({ success: true, message: 'Pendaftaran berhasil! Silakan masuk menggunakan akun baru Anda.' });
    });
});

// 3. API RINGKASAN KAMAR
app.get('/api/kamar', (req, res) => {
    const sql = "SELECT * FROM kamar"; 
    db.query(sql, (err, result) => {
        if (err) {
            console.error("Gagal mengambil data:", err);
            res.status(500).send("Terjadi kesalahan pada server");
        } else {
            res.json(result); 
        }
    });
});

app.get('/api/kamar/detail/:tipe', (req, res) => {
    const tipeKamar = req.params.tipe;
    const sql = "SELECT nomor_kamar, status, harga FROM kamar WHERE tipe_kamar = ?";
    
    db.query(sql, [tipeKamar], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// ==========================================
// API UNTUK MENYIMPAN PEMESANAN (BOOKING)
// ==========================================
app.post('/api/booking', upload.single('foto_ktp'), (req, res) => {
    if (!req.file) {
        console.error("Foto KTP tidak ditemukan dalam form!");
        return res.status(400).json({ success: false, message: "Foto KTP wajib diunggah!" });
    }

    const fotoKtpName = req.file.filename;

    const { 
        id_user, tipe_kamar, nomor_kamar, nama_lengkap, 
        nomor_wa, email, alamat_asal, nama_darurat, nomor_darurat, 
        tanggal_masuk, durasi_sewa, total_harga, metode_pembayaran 
    } = req.body;

    const sql = `INSERT INTO booking 
        (id_user, tipe_kamar, nomor_kamar, nama_lengkap, nomor_wa, email, alamat_asal, nama_darurat, nomor_darurat, metode_pembayaran, tanggal_masuk, durasi_sewa, total_harga, foto_ktp) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
        id_user, tipe_kamar, nomor_kamar, nama_lengkap, 
        nomor_wa, email, alamat_asal, nama_darurat, nomor_darurat, 
        metode_pembayaran, tanggal_masuk, durasi_sewa, total_harga, fotoKtpName
    ];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("Gagal simpan data booking:", err.message);
            return res.status(500).json({ success: false, message: "Error Database: " + err.message });
        }
        res.json({ success: true, message: "Booking berhasil disimpan!" });
    });
});

// ==========================================
// 🚀 JALUR UPDATE STRUKTUR DATABASE
// ==========================================
app.get('/api/fix-db', (req, res) => {
    const sqlFix = "ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'penghuni', 'user') DEFAULT 'user'";
    db.query(sqlFix, (err, result) => {
        if (err) {
            return res.send("Gagal mengupdate database: " + err.message);
        }
        res.send("<h1>Mantap! Database berhasil di-upgrade. Sekarang kolom role bisa menerima 'user'.</h1>");
    });
});

// ==========================================
// 🚀 API DASHBOARD ADMIN
// ==========================================

// 1. Ambil Angka Statistik Ringkasan
app.get('/api/admin/stats', (req, res) => {
    const queryTotalKamar = "SELECT COUNT(*) AS total FROM kamar";
    const queryKamarTerisi = "SELECT COUNT(*) AS total FROM kamar WHERE LOWER(status) = 'terisi' OR LOWER(status) = 'booked' OR status = '0'";
    
    db.query(queryTotalKamar, (err, resTotal) => {
        if (err) {
            console.error("Gagal hitung total kamar:", err);
            return res.status(500).json({ success: false, message: "Error DB Total Kamar" });
        }
        
        db.query(queryKamarTerisi, (err, resTerisi) => {
            if (err) {
                console.error("Gagal hitung kamar terisi:", err);
                return res.status(500).json({ success: false, message: "Error DB Kamar Terisi" });
            }
            
            const totalSemuaKamar = resTotal[0].total || 0;
            const totalKamarTerisi = resTerisi[0].total || 0;
            const sisaKamarTersedia = totalSemuaKamar - totalKamarTerisi;
            
            res.json({
                success: true,
                totalPenghuni: totalKamarTerisi,
                kamarTersedia: sisaKamarTersedia,
                laporanBaru: 0
            });
        });
    });
});

// 2. Ambil List Data Pemesanan Kamar (VERSI AMAN - PASTI MUNCUL)
app.get('/api/admin/bookings', (req, res) => {
    // Query ini akan mengambil semua data yang statusnya BUKAN 'Disetujui'
    const sql = "SELECT * FROM booking WHERE status_booking != 'Disetujui' OR status_booking IS NULL";
    
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Gagal mengambil data booking:", err);
            return res.status(500).json({ success: false, message: "Gagal mengambil data." });
        }
        res.json({ success: true, data: results });
    });
});
// =======================================================
// 🚀 API UNTUK MENYETUJUI PEMESANAN (OTOMATIS UBAH ROLE USER -> PENGHUNI)
// =======================================================
app.put('/api/admin/bookings/approve/:id', (req, res) => {
    const bookingId = req.params.id;

    // 1. Ambil data dari tabel 'booking' 
    db.query('SELECT * FROM booking WHERE id = ?', [bookingId], (err, results) => {
        if (err) {
            console.error("Detail error backend saat approve:", err);
            return res.status(500).json({ success: false, message: "Gagal menyetujui, ada gangguan koneksi ke database." });
        }

        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: "Data pemesanan tidak ditemukan." });
        }

        const dataSewa = results[0];

        // VALIDASI: Cegah data cacat
        if (!dataSewa.nomor_kamar || dataSewa.nomor_kamar === '-') {
            return res.status(400).json({ 
                success: false, 
                message: "Gagal menyetujui. Nomor kamar pada data pemesanan ini tidak valid atau kosong!" 
            });
        }

        // 2. Update status_booking menjadi 'Disetujui'
        db.query("UPDATE booking SET status_booking = 'Disetujui' WHERE id = ?", [bookingId], (errUpdateBooking) => {
            if (errUpdateBooking) {
                console.error("Gagal update status booking:", errUpdateBooking);
                return res.status(500).json({ success: false, message: "Gagal memperbarui status pemesanan." });
            }

            // 3. Sinkronisasi status kamar di tabel 'kamar' menjadi 'terisi'
            db.query("UPDATE kamar SET status = 'terisi' WHERE nomor_kamar = ?", [dataSewa.nomor_kamar], (errUpdateKamar) => {
                if (errUpdateKamar) {
                    console.error("Gagal update status kamar:", errUpdateKamar);
                    return res.status(500).json({ success: false, message: "Booking disetujui, tetapi gagal memperbarui status fisik kamar." });
                }

                // 4. 🔥 LANGKAH SAKTI: Otomatis ubah role user tersebut menjadi 'penghuni' di tabel users
                db.query("UPDATE users SET role = 'penghuni' WHERE id = ?", [dataSewa.id_user], (errUpdateRole) => {
                    if (errUpdateRole) {
                        console.error("Gagal update role user menjadi penghuni:", errUpdateRole);
                        // Kita tetap loloskan res.json karena booking & kamar sudah aman, tapi beri info log
                    }
                    
                    // Sukses besar! Kirim respon balik ke frontend
                    res.json({ success: true, message: "Pemesanan berhasil disetujui dan user resmi menjadi Penghuni Kost!" });
                });
            });
        });
    });
});
// 3. JALUR UNTUK MENGAMBIL DATA TABEL PENGHUNI (Yang Sudah Disetujui)
app.get('/api/admin/penghuni', (req, res) => {
    const sql = "SELECT * FROM booking WHERE status_booking = 'Disetujui'";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Gagal mengambil data penghuni:", err);
            return res.status(500).json({ success: false, message: "Gagal mengambil data penghuni." });
        }
        res.json({ success: true, data: results });
    });
});
app.get('/api/fix-db-v2', (req, res) => {
    // Menambahkan kolom status_booking agar kita bisa membedakan mana yang masih pending dan mana yang sudah jadi penghuni
    const sqlAddColumn = "ALTER TABLE booking ADD COLUMN status_booking VARCHAR(20) DEFAULT 'Pending'";
    db.query(sqlAddColumn, (err, result) => {
        if (err) {
            return res.send("Kolom mungkin sudah ada atau error: " + err.message);
        }
        res.send("<h1>Mantap! Kolom status_booking berhasil ditambahkan ke database Aiven.</h1>");
    });
});
// ==========================================
// 🚀 API UNTUK MENGHAPUS / MENOLAK PEMESANAN
// ==========================================
app.delete('/api/admin/bookings/reject/:id', (req, res) => {
    const idBooking = req.params.id;
    const sql = "DELETE FROM booking WHERE id = ? OR nama_lengkap = ?"; 
    
    db.query(sql, [idBooking, idBooking], (err, result) => {
        if (err) {
            console.error("Gagal hapus data:", err);
            return res.status(500).json({ success: false, message: err.message });
        }
        res.json({ success: true, message: "Pemesanan berhasil ditolak & dihapus!" });
    });
});

// ==========================================
// 🚀 2. JALUR SAKTI: BERSIHKAN DATA CACAT LAMA
// ==========================================
app.get('/api/bersihkan-data', (req, res) => {
    db.query("TRUNCATE TABLE booking", (err, result) => {
        if (err) {
            return res.send("Gagal membersihkan data: " + err.message);
        }
        res.send(`
            <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                <h1 style="color: #2e7d32;">Berhasil! 🧹✨</h1>
                <p>Semua data lama yang rusak sudah dihapus bersih dari database Aiven.</p>
                <a href="/dashboard-admin.html" style="background: #1a1a1a; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Kembali ke Dashboard Admin</a>
            </div>
        `);
    });
});
// JALUR DARURAT: MEMPERBAIKI ROLE AYU NINGSIH DI DATABASE
app.get('/api/fix-ayu-sekarang', (req, res) => {
    db.query("UPDATE users SET role = 'penghuni' WHERE nama_lengkap LIKE '%Ayu%'", (err, result) => {
        if (err) {
            return res.status(500).send("Gagal mengupdate database: " + err.message);
        }
        res.send("<h1>Selesai! Akun Ayu Ningsih di database cloud sekarang SUDAH RESMI JADI PENGHUNI. Silakan coba login ulang!</h1>");
    });
});
// 6. JALANKAN SERVER
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`Server Node.js kamu sudah jalan, silakan buka:`);
    console.log(`http://localhost:${PORT}`);
    console.log(`==================================================`);
});