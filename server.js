const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

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

// 1. KONEKSI KE DATABASE XAMPP
const db = mysql.createConnection({
    host: "mysql-3ef31308-itaa.h.aivencloud.com",
    port: 21505,
    user: "avnadmin",
    password: "AVNS_KTS-uu7yNx2MenbhqpF", // <--- Pastikan password ini sesuai dengan yang kamu salin dari Aiven
    database: "defaultdb",
    ssl: {
        rejectUnauthorized: false // <--- WAJIB TAMBAHKAN BARIS INI agar koneksinya aman & diterima Aiven
    }
});
db.connect((err) => {
    if (err) {
        console.error('Gagal konek database Aiven:', err);
        return;
    }
    console.log('Database Aiven Cloud Terhubung!');
});

// Middleware untuk membaca folder "public" secara otomatis
app.use(express.static(path.join(__dirname, 'public')));
// Izinkan aplikasi membaca folder uploads secara publik
app.use('/uploads', express.static('uploads'));

// 2. JALUR UTAMA (Membuka index.html saat pertama kali diakses)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 3. API RINGKASAN KAMAR: Mengelompokkan 20 kamar menjadi 4 tipe untuk halaman utama (kamar.html)
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

// 4. API DETAIL KAMAR: Mengambil daftar nomor kamar spesifik (Misal: A1-A5) untuk dropdown Form Booking
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

// 5. API PROSES FORM BOOKING & UPLOAD FILE KTP/KK
app.post('/api/booking', upload.fields([{ name: 'foto_ktp' }, { name: 'foto_kk' }]), (req, res) => {
    const data = req.body;
    
    // Mengambil nama file baru yang di-generate oleh multer
    const namaFileKtp = req.files['foto_ktp'] ? req.files['foto_ktp'][0].filename : '';
    const namaFileKk = req.files['foto_kk'] ? req.files['foto_kk'][0].filename : '';

    // A. Masukkan biodata pengunjung ke tabel penghuni
    const sqlPenghuni = `
        INSERT INTO penghuni (nama_lengkap, nomor_wa, email, alamat_asal, nama_darurat, nomor_darurat, foto_ktp, foto_kk, metode_pembayaran) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const nilaiPenghuni = [
        data.nama_lengkap, data.nomor_wa, data.email, data.alamat_asal, 
        data.nama_darurat, data.nomor_darurat, namaFileKtp, namaFileKk, data.metode_pembayaran
    ];

    db.query(sqlPenghuni, nilaiPenghuni, (err, hasilPenghuni) => {
        if (err) {
            console.error("Gagal simpan data penghuni:", err);
            return res.status(500).send("Gagal memproses pendaftaran bulanan.");
        }

        const idPenghuniBaru = hasilPenghuni.insertId; // Dapetin ID otomatis si penghuni baru

        // B. KONEKSIKAN KE KAMAR: Ubah status kamar pilihan dari 'Kosong' jadi 'Terisi'
        const sqlKamar = "UPDATE kamar SET status = 'Terisi', id_penghuni = ? WHERE nomor_kamar = ?";
        
        db.query(sqlKamar, [idPenghuniBaru, data.nomor_kamar], (errKamar) => {
            if (errKamar) {
                console.error("Gagal update status kamar:", errKamar);
                return res.status(500).send("Data tersimpan, tapi gagal mengunci kamar.");
            }
            
            // Respon sukses halaman
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
});

// 6. JALANKAN SERVER
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`Server Node.js kamu sudah jalan, silakan buka:`);
    console.log(`http://localhost:${PORT}`);
    console.log(`==================================================`);
});