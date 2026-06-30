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
// 1. KONEKSI KE DATABASE AIVEN (ANTI-ECONNRESET)
// =======================================================
const dbConfig = {
    host: "mysql-3ef31308-itaa.h.aivencloud.com",
    port: 21505,
    user: "avnadmin",
    password: "AVNS_KTS-uu7yNx2MenbhqpF", 
    database: "defaultdb",
    waitForConnections: true,
    connectionLimit: 15, 
    queueLimit: 0,
    
    enableKeepAlive: true, 
    keepAliveInitialDelay: 10000, 
    connectTimeout: 30000,
    acquireTimeout: 30000,
    
    ssl: {
        rejectUnauthorized: false 
    }
};

let db = mysql.createPool(dbConfig);

// Fungsi pengawas koneksi database + AUTOMATIC REPAIR TYPE DATA
function handleDisconnect() {
    db.getConnection((err, connection) => {
        if (err) {
            console.error('🔥 Gagal konek database Aiven. Mencoba lagi dalam 5 detik...', err.message);
            db = mysql.createPool(dbConfig);
            setTimeout(handleDisconnect, 5000);
            return;
        }
        console.log('✅ Database Aiven Cloud Terhubung Stabil & Siap Pakai (Anti-Badai)!');
        
        // AKALAN SAKTI: Otomatis paksa perbesar kolom status_booking di background biar anti-error truncated!
        const sqlAutoFix = "ALTER TABLE booking MODIFY COLUMN status_booking VARCHAR(255) DEFAULT 'Pending'";
        connection.query(sqlAutoFix, (errFix) => {
            if (errFix) {
                console.log("ℹ️ Info perbaikan otomatis:", errFix.message);
            } else {
                console.log("🚀 SAKTI: Kolom status_booking otomatis diperbesar ke VARCHAR(255) oleh sistem!");
            }
            connection.release();
        });
    });
}

handleDisconnect();

// Middleware file statis
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static('uploads'));

// JALUR UTAMA
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
                nama: user.nama_panggilan || user.nama_lengkap.split(' ')[0], 
                role: user.role,
                foto: user.foto_profil 
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

// ==========================================
// 🚀 API KAMAR
// ==========================================
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

    console.log("Frontend kirim:", req.params.tipe);

    const sql = `
        SELECT nomor_kamar, status, harga
        FROM kamar
        WHERE tipe_kamar = ?
    `;

    db.query(sql, [req.params.tipe], (err, results) => {

        console.log("Error:", err);
        console.log("Hasil:", results);

        res.json(results);

    });

});
app.get('/api/test-a', (req, res) => {

    db.query("SELECT * FROM kamar", (err, hasil) => {

        if (err) {
            console.log(err);
            return res.json(err);
        }

        console.log("Isi tabel kamar:", hasil);

        res.json(hasil);

    });

});
app.get('/api/cek-db', (req, res) => {

    db.query("SELECT DATABASE() AS db", (err, hasilDb) => {

        if (err) return res.json(err);

        db.query("SELECT * FROM kamar", (err2, hasilKamar) => {

            if (err2) return res.json(err2);

            res.json({
                database: hasilDb,
                jumlahData: hasilKamar.length,
                data: hasilKamar
            });

        });

    });

});
app.post('/api/booking', upload.single('foto_ktp'), (req, res) => {
    const { id_user, tipe_kamar, nomor_kamar, nama_lengkap, nomor_wa, email, alamat_asal, nama_darurat, nomor_darurat, tanggal_masuk, durasi_sewa, total_harga, metode_pembayaran } = req.body;
    const foto_ktp = req.file ? req.file.filename : null;

    // Set default status sebagai 'Pending' agar terbaca di halaman admin kamu
    const status_booking = 'Pending'; 

    const sql = `INSERT INTO booking (id_user, tipe_kamar, nomor_kamar, nama_lengkap, nomor_wa, email, alamat_asal, foto_ktp, nama_darurat, nomor_darurat, tanggal_masuk, durasi_sewa, total_harga, metode_pembayaran, status_booking) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [id_user, tipe_kamar, nomor_kamar, nama_lengkap, nomor_wa, email, alamat_asal, foto_ktp, nama_darurat, nomor_darurat, tanggal_masuk, durasi_sewa, total_harga, metode_pembayaran, status_booking];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("🔥 DATABASE ERROR:", err.message);
            // Jika database gagal, kirim status false agar frontend TIDAK memunculkan pop-up sukses
            return res.status(500).json({ success: false, message: "Gagal menyimpan ke database: " + err.message });
        }
        
        // PENTING: Hanya kirim success true jika database BERHASIL insert!
        console.log("✅ Data booking berhasil masuk DB dengan ID:", result.insertId);
        res.json({ success: true, message: "Booking Berhasil Disimpan!" });
    });
});

// ==========================================
// 🚀 API LAPORAN (PENGHUNI) - FIX TOTAL ANTI-ERROR
// ==========================================
app.post('/api/laporan', (req, res) => {
    const { nomor_kamar, kategori, deskripsi, deskripsi_kendala } = req.body;
    const isiDeskripsi = deskripsi || deskripsi_kendala; 
    
    console.log("Data laporan masuk ke server:", { nomor_kamar, kategori, isiDeskripsi });

    if (!nomor_kamar || !kategori || !isiDeskripsi) {
        return res.status(400).json({ 
            success: false, 
            message: "Gagal: Data tidak lengkap! Pastikan nomor kamar, kategori, and deskripsi sudah terisi." 
        });
    }

    const sql = `INSERT INTO laporan_kerusakan (nomor_kamar, kategori, deskripsi_kendala, status) VALUES (?, ?, ?, 'Belum Ditangani')`;
    
    db.query(sql, [nomor_kamar, kategori, isiDeskripsi], (err, result) => {
        if (err) {
            console.error("🔥 ERROR KUERI DATABASE LAPORAN:", err.message);
            return res.status(500).json({ 
                success: false, 
                message: "Gagal menyimpan laporan ke database: " + err.message 
            });
        }
        res.json({ success: true, message: "Laporan berhasil terkirim ke Admin!" });
    });
});

// ==========================================
// 🚀 API STATISTIK & DATA DASHBOARD ADMIN (FIXED!)
// ==========================================
app.get('/api/admin/stats', (req, res) => {
    const queryTotalKamar = "SELECT COUNT(*) AS total FROM kamar";
    const queryKamarTerisi = "SELECT COUNT(*) AS total FROM kamar WHERE LOWER(status) = 'terisi' OR LOWER(status) = 'booked' OR status = '0'";
    const queryLaporan = "SELECT id, nomor_kamar, kategori, deskripsi_kendala, status FROM laporan_kerusakan ORDER BY id DESC";
    
    // Perbaikan hitungan laporan aktif (hanya menghitung yang belum berstatus 'Selesai')
    const queryLaporanAktif = "SELECT COUNT(*) AS total FROM laporan_kerusakan WHERE LOWER(TRIM(status)) != 'selesai'";
    
    db.query(queryTotalKamar, (err, resTotal) => {
        if (err) return res.status(500).json({ success: false, message: "Error DB Total Kamar" });
        
        db.query(queryKamarTerisi, (err2, resTerisi) => {
            if (err2) return res.status(500).json({ success: false, message: "Error DB Kamar Terisi" });
            
            db.query(queryLaporan, (err3, resLaporan) => {
                if (err3) return res.status(500).json({ success: false, message: "Error DB Laporan" });
                
                db.query(queryLaporanAktif, (err4, resLaporanAktif) => {
                    if (err4) return res.status(500).json({ success: false, message: "Error DB Laporan Aktif" });
                    
                    const totalSemuaKamar = resTotal[0].total || 0;
                    const totalKamarTerisi = resTerisi[0].total || 0;
                    const sisaKamarTersedia = totalSemuaKamar - totalKamarTerisi;
                    const jumlahLaporanBaru = resLaporanAktif[0].total || 0;
                    
                    res.json({
                        success: true,
                        totalPenghuni: totalKamarTerisi,
                        kamarTersedia: sisaKamarTersedia,
                        laporanBaru: jumlahLaporanBaru, 
                        laporanData: resLaporan 
                    });
                });
            });
        });
    });
});

// ==========================================
// 🚀 API UNTUK MENGAMBIL DATA BOOKING YANG PENDING (TABEL KONFIRMASI)
// ==========================================
const handleGetBookingsPending = (req, res) => {
    const sql = "SELECT * FROM booking WHERE LOWER(TRIM(status_booking)) = 'pending' OR status_booking IS NULL OR status_booking = ''";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Gagal mengambil data booking pending:", err.message);
            return res.status(500).json({ success: false, message: "Gagal mengambil data booking." });
        }
        res.json({ success: true, data: results });
    });
};

// Kita daftarkan ke seluruh kemungkinan endpoint yang dipanggil frontend kamu
app.get('/api/admin/bookings', handleGetBookingsPending);
app.get('/api/admin/booking', handleGetBookingsPending);
app.get('/api/bookings', handleGetBookingsPending);
app.get('/api/booking', handleGetBookingsPending);

// ==========================================
// 🚀 API BOOKINGS ADMIN (APPROVE)
// ==========================================
const fungsiApproveBooking = (req, res) => {
    const bookingId = req.params.id;

    db.query('SELECT * FROM booking WHERE id = ?', [bookingId], (err, results) => {
        if (err) {
            console.error("Detail error backend saat approve:", err);
            return res.status(500).json({ success: false, message: "Gagal menyetujui, ada gangguan koneksi." });
        }

        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: "Data pemesanan tidak ditemukan." });
        }

        const dataSewa = results[0];

        if (!dataSewa.nomor_kamar || dataSewa.nomor_kamar === '-') {
            return res.status(400).json({ 
                success: false, 
                message: "Gagal menyetujui. Nomor kamar tidak valid!" 
            });
        }

        db.query("UPDATE booking SET status_booking = 'Disetujui' WHERE id = ?", [bookingId], (errUpdateBooking) => {
            if (errUpdateBooking) {
                return res.status(500).json({ success: false, message: "Gagal memperbarui status pemesanan." });
            }

            db.query("UPDATE kamar SET status = 'terisi' WHERE nomor_kamar = ?", [dataSewa.nomor_kamar], (errUpdateKamar) => {
                if (errUpdateKamar) {
                    return res.status(500).json({ success: false, message: "Gagal memperbarui status fisik kamar." });
                }

                db.query("UPDATE users SET role = 'penghuni' WHERE id = ?", [dataSewa.id_user], (errUpdateRole) => {
                    res.json({ success: true, message: "Pemesanan disetujui, user resmi jadi Penghuni!" });
                });
            });
        });
    });
};

app.put('/api/admin/bookings/approve/:id', fungsiApproveBooking);
app.put('/api/admin/booking/approve/:id', fungsiApproveBooking);
app.post('/api/admin/bookings/approve/:id', fungsiApproveBooking);
app.post('/api/admin/booking/approve/:id', fungsiApproveBooking);

app.delete('/api/admin/bookings/reject/:id', (req, res) => {
    const idBooking = req.params.id;
    const sql = "DELETE FROM booking WHERE id = ? OR nama_lengkap = ?"; 
    db.query(sql, [idBooking, idBooking], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: "Pemesanan berhasil ditolak & dihapus!" });
    });
});

// ==========================================
// 🚀 API DATA PENGHUNI (YANG DISETUJUI)
// ==========================================
app.get('/api/admin/penghuni', (req, res) => {
    const sql = "SELECT * FROM booking WHERE status_booking = 'Disetujui'";
    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({ success: false, message: "Gagal mengambil data penghuni." });
        }
        res.json({ success: true, data: results });
    });
});

// ==========================================
// 🚀 API ADMIN: AMBIL SEMUA DATA LAPORAN KERUSAKAN
// ==========================================
app.get('/api/admin/laporan', (req, res) => {
    const sql = "SELECT id, nomor_kamar, kategori, deskripsi_kendala, status FROM laporan_kerusakan ORDER BY id DESC";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Gagal mengambil data laporan admin di DB:", err);
            return res.status(500).json({ success: false, message: "Gagal mengambil data dari database." });
        }
        res.json({ success: true, data: results });
    });
});

// ==========================================
// 🚀 API ADMIN: TANDAI LAPORAN SELESAI
// ==========================================
const handleLaporanSelesai = (req, res) => {
    const idLaporan = req.params.id;
    const sql = "UPDATE laporan_kerusakan SET status = 'Selesai' WHERE id = ?";

    db.query(sql, [idLaporan], (err, result) => {
        if (err) {
            console.error("Gagal update status laporan:", err);
            return res.status(500).json({ success: false, message: "Gagal mengupdate database." });
        }
        res.json({ success: true, message: "Mantap! Laporan berhasil ditandai selesai." });
    });
};

app.put('/api/admin/laporan/selesai/:id', handleLaporanSelesai);
app.post('/api/admin/laporan/selesai/:id', handleLaporanSelesai);

// ==========================================
// 🚀 JALUR FIXER & UTILITY DB
// ==========================================
app.get('/api/fix-db', (req, res) => {
    const sqlFix = "ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'penghuni', 'user') DEFAULT 'user'";
    db.query(sqlFix, (err, result) => {
        if (err) return res.send("Gagal mengupdate database: " + err.message);
        res.send("<h1>Mantap! Database berhasil di-upgrade. Kolom role bisa menerima 'user'.</h1>");
    });
});

app.get('/api/fix-db-v2', (req, res) => {
    const sqlModifyColumn = "ALTER TABLE booking MODIFY COLUMN status_booking VARCHAR(255) DEFAULT 'Pending'";
    db.query(sqlModifyColumn, (err, result) => {
        if (err) return res.send("Gagal memperbaiki ukuran kolom: " + err.message);
        res.send("<h1>Mantap! Ukuran kolom status_booking berhasil diperbesar menjadi VARCHAR(255). Silakan isi booking kembali!</h1>");
    });
});

app.get('/api/bersihkan-data', (req, res) => {
    db.query("TRUNCATE TABLE booking", (err, result) => {
        if (err) return res.send("Gagal membersihkan data: " + err.message);
        res.send("<h1 style='color: #2e7d32; text-align:center;'>Berhasil! Semua data lama dibersihkan.</h1>");
    });
});

app.get('/api/fix-ayu-sekarang', (req, res) => {
    db.query("UPDATE users SET role = 'penghuni' WHERE nama_lengkap LIKE '%Ayu%'", (err, result) => {
        if (err) return res.status(500).send("Gagal update database: " + err.message);
        res.send("<h1>Selesai! Akun Ayu Ningsih resmi jadi Penghuni. Silakan login ulang!</h1>");
    });
});
// ==========================================
// API TAGIHAN PENGHUNI
// ==========================================
app.get('/api/penghuni/tagihan/:id', (req, res) => {
    const idUser = req.params.id;

    const sql = `
        SELECT
            nomor_kamar,
            tipe_kamar,
            tanggal_masuk,
            durasi_sewa,
            total_harga,
            metode_pembayaran,
            status_booking
        FROM booking
        WHERE id_user = ?
        ORDER BY id DESC
        LIMIT 1
    `;

    db.query(sql, [idUser], (err, result) => {

        if (err) {
            console.error(err);
            return res.status(500).json({
                success:false,
                message:"Database error"
            });
        }

        if(result.length===0){
            return res.json({
                success:false,
                message:"Belum ada data booking"
            });
        }

        res.json({
            success:true,
            data:result[0]
        });

    });

});
app.get('/api/fix-laporan', (req, res) => {
    const sqlStatusAja = "ALTER TABLE laporan_kerusakan ADD COLUMN status VARCHAR(50) DEFAULT 'Belum Ditangani'";
    db.query(sqlStatusAja, (err, result) => {
        if (err) {
            console.error("Detail Error:", err.message);
            return res.send("<h1>Waduh, cek terminal! Error: " + err.message + "</h1>");
        }
        res.send("<h1>FIXED! Kolom 'status' sekarang resmi masuk ke database. Silakan tes kirim laporannya, Ta!</h1>");
    });
});

// JALANKAN SERVER
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`Server Node.js kamu sudah jalan, silakan buka:`);
    console.log(`http://localhost:${PORT}`);
    console.log(`==================================================`);
});