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
        // Nama file diubah jadi: AngkaUnik-NamaAsli.jpg agar tidak kembar
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// ==========================================
// 1. KONEKSI KE DATABASE AIVEN (PAKAI POOL)
// ==========================================
const db = mysql.createPool({
    host: "mysql-3ef31308-itaa.h.aivencloud.com",
    port: 21505,
    user: "avnadmin",
    password: "AVNS_KTS-uu7yNx2MenbhqpF", 
    database: "defaultdb",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        rejectUnauthorized: false // WAJIB untuk cloud
    }
});

// Cek apakah Pool berhasil terhubung
db.getConnection((err, connection) => {
    if (err) {
        console.error('Gagal konek database Aiven:', err);
        return;
    }
    console.log('Database Aiven Cloud Terhubung dengan Mantap (Anti Putus)!');
    connection.release(); // Kembalikan koneksi agar tidak nyangkut
});

// Middleware untuk membaca folder "public" secara otomatis
app.use(express.static(path.join(__dirname, 'public')));
// Izinkan aplikasi membaca folder uploads secara publik
app.use('/uploads', express.static('uploads'));

// 2. JALUR UTAMA (Membuka index.html saat pertama kali diakses)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 🚀 FITUR BARU: API LOGIN
// ==========================================
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // Cari user berdasarkan username di tabel users
    db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
        if (err) {
            console.error("Error saat login:", err);
            return res.status(500).json({ success: false, message: 'Server database error' });
        }

        // Jika username tidak ditemukan
        if (results.length === 0) {
            return res.status(401).json({ success: false, message: 'Username atau password salah!' });
        }

        const user = results[0];

        // Cek cocok tidaknya password
        if (password !== user.password) {
            return res.status(401).json({ success: false, message: 'Username atau password salah!' });
        }

        // JIKA BERHASIL: Kirim role-nya ke frontend
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

// 4. API DETAIL KAMAR (Dropdown Form Booking)
app.get('/api/kamar/detail/:tipe', (req, res) => {
    const tipeKamar = 'Tipe ' + req.params.tipe; 
    const sql = "SELECT nomor_kamar, harga, fasilitas, status FROM kamar WHERE tipe_kamar = ?";
    
    db.query(sql, [tipeKamar], (err, result) => {
        if (err) {
            console.error("Gagal mengambil detail kamar:", err);
            res.status(500).send("Terjadi kesalahan pada server");
        } else {
            res.json(result); 
        }
    });
});

// 5. API PROSES FORM BOOKING 
app.post('/api/booking', upload.fields([{ name: 'foto_ktp' }, { name: 'foto_kk' }]), (req, res) => {
    const data = req.body;
    
    const namaFileKtp = req.files['foto_ktp'] ? req.files['foto_ktp'][0].filename : '';
    const namaFileKk = req.files['foto_kk'] ? req.files['foto_kk'][0].filename : '';

    const idUserSementaran = data.id_user || 1; 

    const sqlBooking = `
        INSERT INTO booking (id_user, tipe_kamar, nomor_kamar, nama_lengkap, nomor_wa, email, alamat_asal, nama_darurat, nomor_darurat, metode_pembayaran, foto_ktp, foto_kk) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const nilaiBooking = [
        idUserSementaran, data.tipe_kamar, data.nomor_kamar, data.nama_lengkap, 
        data.nomor_wa, data.email, data.alamat_asal, data.nama_darurat, 
        data.nomor_darurat, data.metode_pembayaran, namaFileKtp, namaFileKk
    ];

    db.query(sqlBooking, nilaiBooking, (err) => {
        if (err) {
            console.error("Gagal simpan data booking:", err);
            return res.status(500).send("Gagal memproses booking kamar.");
        }

        res.send(`
            <div style="text-align: center; margin-top: 50px; font-family: 'Poppins', sans-serif;">
                <h2 style="color: #2e7d32;">🎉 PEMESANAN KAMAR BERHASIL! 🎉</h2>
                <p>Data diri Anda dan berkas digital telah aman tersimpan di sistem Kost Yu.</p>
                <br>
                <a href="/kamar.html" style="padding: 10px 20px; background-color: #002060; color: white; text-decoration: none; border-radius: 5px;">Kembali ke Beranda</a>
            </div>
        `);
    });
});

// 6. JALANKAN SERVER
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`Server Node.js kamu sudah jalan, silakan buka:`);
    console.log(`http://localhost:${PORT}`);
    console.log(`==================================================`);
});