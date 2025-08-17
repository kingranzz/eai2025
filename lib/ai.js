// Owner Bot : autoresbot.com

const config                        = require('../config');
const ApiAutoresbot                 = require('api-autoresbot');
const api                           = new ApiAutoresbot(config.API_KEY);
const { writeFile }                 = require('fs').promises;
const moment                        = require('moment');
const path                          = require('path');
const crypto                        = require('crypto');
const { downloadMediaMessage  }     = require('baileys');
const url                           = require('url');
const pino                          = require("pino");
const logger                        = pino({ level: "silent" });
const { sendImageAsSticker }        = require("./exif");
const { getSession, updateSession, resetSession } = require("./session");
const { GEMINI_TEXT }               = require("./gemini");
const { searchSong }                = require('./ytdl');
const { getBuffer, displayMenu,log, checkUrlType }    = require('./utils');
const { HDR, TIKTOK, SEARCH_IMAGE, FACEBOOK, IG }           = require('./features');
const { detectLink }                                        = require('./detect');
const  { setActiveFitur, getActiveFitur, resetActiveFitur } = require('./activeFeatures');
const { addUser, editUser, deleteUser, getUser, resetUsersJson, checkLimit, reduceLimit, getUserPremium, getAllUsers } = require('./users');
// addUser, editUser(remoteJid, 5);, deleteUser(remoteJid), getUser, isPremiumUser, checkLimit,reduceLimit



/**
 * Function to download media message, save to a file with a random name, and return the buffer
 * @param {Object} message - The message object from which to download media
 * @param {Object} sock - The socket object for handling media reupload
 * @param {string} directory - The directory where the file should be saved
 * @param {Object} logger - The logger object (optional)
 * @returns {Buffer} - The buffer of the downloaded media
 */
async function downloadAndSaveMedia(message, sock, logger) {
    try {
        const directory = './tmp';

        // Menghasilkan nama file acak
        const randomFileName = crypto.randomBytes(16).toString('hex') + '.jpg';
        const filePath = path.join(directory, randomFileName);
        
        // Mengunduh media
        const buffer = await downloadMediaMessage(message, 'buffer', {}, {
            logger,
            reuploadRequest: sock.updateMediaMessage
        });
        
        // Menyimpan buffer ke file
        await writeFile(filePath, buffer);
        
        // Mengembalikan objek yang berisi buffer dan path
        return { buffer, filePath };
    } catch (error) {
        throw new Error('Error downloading and saving media: ' + error.message);
    }
}

async function downloadQuotedMedia(message, folderPath) {

    const directory = './tmp';


    const { downloadContentFromMessage } = require("baileys");
 
    try {
        // Validasi apakah pesan mengutip media
        if (
            !message.message ||
            !message.message.extendedTextMessage ||
            !message.message.extendedTextMessage.contextInfo ||
            !message.message.extendedTextMessage.contextInfo.quotedMessage
        ) {
            console.log("Pesan ini tidak mengutip media.");
            return null;
        }

        const quotedMessage = message.message.extendedTextMessage.contextInfo.quotedMessage;

        let mediaType = '';
        let mediaMessage = null;

        // Deteksi jenis media
        if (quotedMessage.imageMessage) {
            mediaType = 'image';
            mediaMessage = quotedMessage.imageMessage;
        } else if (quotedMessage.videoMessage) {
            mediaType = 'video';
            mediaMessage = quotedMessage.videoMessage;
        } else if (quotedMessage.audioMessage) {
            mediaType = 'audio';
            mediaMessage = quotedMessage.audioMessage;
        } else if (quotedMessage.documentMessage) {
            mediaType = 'document';
            mediaMessage = quotedMessage.documentMessage;
        } else if (quotedMessage.stickerMessage) {
            mediaType = 'sticker';
            mediaMessage = quotedMessage.stickerMessage;
        } else if (quotedMessage.viewOnceMessageV2) {
            mediaType = 'image';
            mediaMessage = message.message.extendedTextMessage.contextInfo.quotedMessage.viewOnceMessageV2.message.imageMessage;
        } else {
            return null;
        }

        // Unduh media
        const stream = await downloadContentFromMessage(mediaMessage, mediaType);

        // Tentukan nama file dan ekstensi
        const fileName = mediaMessage.fileName || `${mediaType}_${Date.now()}`;
        const extensionMap = {
            image: '.jpg',
            video: '.mp4',
            audio: '.mp3',
            sticker: '.webp',
        };
        const fileExtension = mediaType === 'document'
            ? path.extname(mediaMessage.fileName || '.bin')
            : extensionMap[mediaType] || '';

        // Tambahkan ekstensi jika belum ada
        const finalFileName = fileName.endsWith(fileExtension) ? fileName : `${fileName}${fileExtension}`;
        const filePath = path.join(directory, finalFileName);

        // Simpan file
        const fileBuffer = [];
        for await (const chunk of stream) {
            fileBuffer.push(chunk);
        }
        // fs.writeFileSync(filePath, Buffer.concat(fileBuffer));

        const buffer = Buffer.concat(fileBuffer);
        await writeFile(filePath, buffer);
        //return finalFileName;

          // Mengembalikan objek yang berisi buffer dan path
          return { buffer, filePath };
    } catch (error) {
        console.error("Gagal mengunduh media:", error);
        return null;
    }
}

// let isSendingReply = false; // flag status

function isValidJid(jid) {
    return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us');
  }

const sendReply = async (sock, remoteJid, rule, message) => {
    try {
        // contoh:
        if (!isValidJid(remoteJid)) {
            return console.log('JID tidak valid, tidak mengirim:', remoteJid);
        }

        // if (isSendingReply) {
        //     console.log('Masih dalam proses, return false');
        //     return false;
        // }
        // isSendingReply = true; // tandai bahwa proses sedang berjalan
        
        //await new Promise(resolve => setTimeout(resolve, 4000));
        // isSendingReply = false;
        
        const { message_type, reply_text, image_url, footer, button_data } = rule;

        // Send text message
        if (message_type === 'text') {
            await sock.sendMessage(remoteJid, { text: reply_text }, { quoted: message });

            // Send image message
        } else if (message_type === 'image' && image_url) {
            await sock.sendMessage(remoteJid, {
                image: { url: image_url },
                caption: reply_text || ''
            }, { quoted: message });

            // Send document message
        } else if (message_type === 'document' && image_url) {
            const fileName = path.basename(image_url); // Get file name from URL
            const mimeType = mime.lookup(fileName); // Get MIME type from file extension

            // Send text before document if available
            if (reply_text && reply_text.trim() !== '') {
                await sock.sendMessage(remoteJid, { text: reply_text }, { quoted: message });
            }

            await sock.sendMessage(remoteJid, {
                document: { url: image_url },
                fileName,
                mimetype: mimeType
            }, { quoted: message });
        } else if (message_type === 'button' && button_data && footer) {
            let buttons = button_data ? JSON.parse(button_data) : [];
            const buttonsArray = buttons.map(button => {
                const [text, id] = button.split('|');
                return { text, id };
            });
            await sendInteractiveMessage(sock, remoteJid, reply_text, footer, buttonsArray);

        } else if (message_type === 'sticker' && image_url) {
            const options = {
                packname: config.sticker_packname,
                author: config.sticker_author
            };
            await sendImageAsSticker(sock, remoteJid, image_url, options, message);

        }else if (message_type === 'vn' && image_url) {
            await sock.sendMessage(remoteJid,
                { audio: image_url, mimetype: 'audio/mp4', ptt: true },
                { quoted: message }
            );
        }
        



        // Proses Play Audio
        if(rule.action && rule.action.content && rule.action.features && rule.action.features == 'play') {
            const songInfo = await searchSong(rule.action.content);
            if (songInfo) {
                const dataYoutubeMP3 = await api.get('/api/downloader/ytplay', {url : songInfo.url });
                if(dataYoutubeMP3.bytes > 94491648) {
                    return await sock.sendMessage(remoteJid, { text: config.error.FILE_TOO_LARGE }, { quoted: message });
                }

                await sock.sendMessage(remoteJid, {
                    audio: {url : dataYoutubeMP3.url},
                    mimetype: "audio/mp4",
                    contextInfo: {
                        externalAdReply: {
                            showAdAttribution: true,
                            title: songInfo.title || "Untitled",
                            body: config.owner_name,
                            sourceUrl: songInfo.url,
                            thumbnailUrl: songInfo.image || "https://example.com/default_thumbnail.jpg",
                            mediaType: 1,
                            renderLargerThumbnail: true
                        }
                    }
                }, { quoted: message });
            } else {
                await sock.sendMessage(remoteJid, { text: config.error.PLAY_ERROR }, { quoted: message });
            }
            resetActiveFitur(remoteJid, "play");
        }

        // Proses Remini
        if(rule.action && rule.action.content && rule.action.features && rule.action.features == 'hd') {
            try {
                // Proses HDR
                const media = await HDR(rule.action.content);
            
                if (media) {
            
                    await sock.sendMessage(remoteJid, {
                        image: media,
                        caption: config.success.hd
                    }, { quoted: message });
                } else {
                    throw new Error("HDR media returned undefined or null");
                }
            
            } catch (e) {
                await sock.sendMessage(remoteJid, {
                    text: e.message || e || config.error.HD_ERROR
                }, { quoted: message });
            }
            resetActiveFitur(remoteJid, "hd");
            
        }

        // Proses cari gambar
        if(rule.action && rule.action.content && rule.action.features && rule.action.features == 'pin') {
            try {
                const media = await SEARCH_IMAGE(rule.action.content);
                
                // Cek apakah media benar-benar berupa buffer dan memiliki properti yang diharapkan
                if (media && media.status && Buffer.isBuffer(media.data)) {
                    await sock.sendMessage(remoteJid, {
                        image: media.data,
                        caption: `Ini kak gambar *${rule.action.content}* nya`
                    }, { quoted: message });
                } else {
                    // Jika bukan buffer atau status tidak valid, lempar error
                    throw new Error(media.message || 'Media bukan buffer atau tidak valid, Silakan coba kembali');
                }
            } catch (e) {
                await sock.sendMessage(remoteJid, {
                    text: e.message || e || config.error.IMAGE_ERROR
                }, { quoted: message });
            }
            resetActiveFitur(remoteJid, "pin");
        }

        // Proses Deteksi Link
        if (rule.action && rule.action.content && rule.action.features === 'detect_link') {
            const content = rule.action.content;

            const sendMessage = async (text, options = {}) => {
                await sock.sendMessage(remoteJid, { text }, options);
            };

            const handleError = async (error) => {
                const errorText = error || 'Hai Kak, sepertinya link yang kamu bagikan tidak valid. Coba cek lagi, ya!';
                return await sendMessage(errorText, { quoted: message });
            };

            if (content.includes('whatsapp.com/channel')) {
                const inviteCode = content;
                try {
                    const data = await api.get('/api/stalker/whatsapp-group', { url: inviteCode });
                    const groupName = data.groupName;
                    const totalFollower = data.channelDesc.match(/\d+/g) || [];
                    const fullText = `Hai Kak, berikut informasi channel yang kamu kirimkan. Channel ini bernama *${groupName}* dengan memiliki *${totalFollower}* follower.`;
                    await sendMessage(fullText);
                } catch (error) {
                    await handleError(error);
                }
            } else if (content.includes('chat.whatsapp.com')) {
                const inviteCode = content.split('/').pop();
                try {
                    const res = await sock.query({
                        tag: "iq",
                        attrs: { type: "get", xmlns: "w:g2", to: "@g.us" },
                        content: [{ tag: "invite", attrs: { code: inviteCode } }]
                    });

                    if (res?.content?.[0]?.attrs) {
                        const { attrs } = res.content[0];
                        const nameGroup = attrs.subject || "undefined";
                        const descGroup = attrs.s_t
                            ? moment(attrs.s_t * 1000).tz("Asia/Jakarta").format("DD-MM-YYYY, HH:mm:ss")
                            : "undefined";
                        const ownerCreated = attrs.creator ? "@" + attrs.creator.split("@")[0] : "undefined";
                        const dataCreated = attrs.creation
                            ? moment(attrs.creation * 1000).tz("Asia/Jakarta").format("DD-MM-YYYY, HH:mm:ss")
                            : "undefined";
                        const sizeMember = attrs.size || "undefined";
                        const idGroup = attrs.id || "undefined";

                        const fullText = `Hai Kak, berikut informasi grup yang kamu kirimkan. Grup ini bernama *${nameGroup}* dengan total *${sizeMember}* anggota. \n\nInformasi lengkapnya:\n - ID Grup: ${idGroup}\n - Dibuat pada: ${dataCreated}\n - Pembuat Grup: *${ownerCreated}*`;
                        await sendMessage(fullText);
                    } else {
                        await handleError(error);
                    }
                } catch (error) {
                    await handleError(error);
                }
            } else if (content.includes('tiktok.com')) {
                try {
                    let res = await TIKTOK(content);
                    if (res.type === 'video') {
                        await sock.sendMessage(remoteJid, { video: { url: res.data.no_watermark }, caption: res.data.title });
                    } else if (res.type === 'slide') {
                        const dataImage = res.data;
                        for (let i = 0; i < Math.min(dataImage.length, 8); i++) {
                            await sock.sendMessage(remoteJid, { image: { url: dataImage[i] } });
                        }
                    }
                } catch (error) {
                    const fullText = 'Hai Kak, sepertinya link tiktok yang kamu bagikan tidak bisa saya download. Coba cek lagi, ya!';
                    await sendMessage(fullText, { quoted: message });
                }
            } else if (content.includes('facebook.com')) {
                let res = await FACEBOOK(content);
                if(res && res.message) {
                    throw new Error(res.message);
                }else {
                    await sock.sendMessage(remoteJid, { video: { url: res }, caption: '' });
                }
            } else if (content.includes('instagram.com')) {
                try {
                    let res = await IG(content); // dapetin URL-nya
                
                    if (content.includes('video')) {
                        await sock.sendMessage(remoteJid, {
                            video: { url: res },
                            caption: 'ini kak videonya'
                        });
                    } else if (content.includes('gambar')) {
                        await sock.sendMessage(remoteJid, {
                            image: { url: res },
                            caption: 'ini kak gambarnya'
                        });
                    } else {
                        await sock.sendMessage(remoteJid, {
                            video: { url: res },
                            caption: 'ini kak videonya'
                        });
                    }
                    return;
                    
                } catch (error) {
                    await handleError(error);
                }
            } else {
                const fullText = 'Hai Kak, sepertinya link yang kamu bagikan tidak dapat di proses sementara waktu. Link yang dapat saya proses berupa link grup whatsapp, link saluran whatsapp dan link tiktok.';
                await sendMessage(fullText, { quoted: message });
            }

            resetActiveFitur(remoteJid, "download");

        }

    } catch (error) {
        const throw_error = `${config.error.THROW} \n\n_*${error}*_`;
        resetActiveFitur(remoteJid, "play");
        resetActiveFitur(remoteJid, "hd");
        resetActiveFitur(remoteJid, "pin");
        resetActiveFitur(remoteJid, "download");
        await sock.sendMessage(remoteJid, { text: throw_error }, { quoted: message });
    }
};

async function handleMessageLocal(content, sock, sender, remoteJid, messageType, session, message, pushName, isQuoted) {
    
    const symbolsToRemove = ['.', '#', '!'];
    const regex = new RegExp(`^[${symbolsToRemove.join('')}]`, 'g');
    const lowerCaseMessage = content.toLowerCase().replace(regex, '').trim();
    const command = lowerCaseMessage.split(' ')[0];
    const isOwner = (remoteJid) => remoteJid === `${config.owner_number}@s.whatsapp.net`;


    const user = getUser(sender)
    const userLimit = checkLimit(user);

    if(!userLimit && !isOwner(sender)) {
        return {
            status: true,
            message_type: 'text',
            reply_text: config.notification.limit
        };
    }

    let info_apikey = '';
    try {
        const data = await api.get('/check_apikey');
        info_apikey = `Apikey Valid \n\nLimit Kamu : ${data.limit_apikey} dan aktif hingga ${data.limit_key_tgl}`
    } catch (error) {
        info_apikey = error.message;
    }
    
    const commandResponses = {
        reset: () => {
            resetSession(sender);
            if (global.conversationHistories && global.conversationHistories[sender]) {
                delete global.conversationHistories[sender];
            }
            return {
                status: true,
                message_type: 'text',
                reply_text: config.notification.reset,
            };
        },
        limit: () => ({
            status: true,
            message_type: 'text',
            reply_text: `_Hai kak, sisa limit harian anda adalah_ ${userLimit}`,
        }),
        apikey: () => ({
            status: true,
            message_type: 'text',
            reply_text: info_apikey,
        }),
        ig: () => ({
            status: true,
            message_type: 'text',
            reply_text: config.notification.ig,
        }),
        tt: () => ({
            status: true,
            message_type: 'text',
            reply_text: config.notification.tt,
        }),
        fb: () => ({
            status: true,
            message_type: 'text',
            reply_text: config.notification.fb,
        }),
        info: () => {
            const info = `*Informasi Script* \n\nName Script: Resbot Ai\nOwner: autoresbot.com\nVersion: ${config.version}\n\n_Script ini tersedia secara gratis, kamu bisa mendownloadnya di_ https://autoresbot.com/download\n\nSaluran Resmi : https://www.whatsapp.com/channel/0029VabMgUy9MF99bWrYja2Q`;
            return {
                status: true,
                message_type: 'text',
                reply_text: info,
            };
        },
        addprem: () => ({
            status: true,
            message_type: 'text',
            reply_text: '_Format Penggunaan:_ *addprem @tag/nomor hari*\n\n_Contoh penggunaan:_ *addprem 6285246154386 30*',
        }),
        delprem: () => ({
            status: true,
            message_type: 'text',
            reply_text: '_Format Penggunaan:_ *delprem nomor*\n\n_Contoh penggunaan:_ *delprem 6285246154386*',
        }),
        editprem: () => ({
            status: true,
            message_type: 'text',
            reply_text: '_Format Penggunaan:_ *editprem nomor hari*\n\n_Contoh penggunaan:_ *editprem 6285246154386 15*',
        }),
        listprem: () => ({
            status: true,
            message_type: 'text',
            reply_text: getUserPremium(),
        }),
        listusers: () => ({
            status: true,
            message_type: 'text',
            reply_text: getAllUsers(),
        }),
    };
    
    // getUserPremium, getAllUsers
    
    const response = commandResponses[lowerCaseMessage];
    if (response) {
        return response();
    }
    
    // addUser, editUser(remoteJid, 5);, deleteUser(remoteJid), getUser, isPremiumUser, checkLimit,reduceLimit
    

    const sendResponse = (text) => ({
        status: true,
        message_type: 'text',
        reply_text: text,
    });
    
    const handleAddPrem = (args) => {
        console.log('args :', args); // contoh: [ 'addprem', '@6285124002196', '10' ]
    
        let rawNumber = args[1];
        const day = args[2];
    
        if (!rawNumber || !day) {
            return sendResponse('Format pesan salah. Gunakan: addprem nomor hari');
        }
    
        // Bersihkan tag jika diawali dengan '@'
        if (rawNumber.startsWith('@')) {
            rawNumber = rawNumber.slice(1);
        }
    
        // Validasi: pastikan hanya angka dan panjang minimal (misal, 10 digit)
        const isValidPhone = /^[0-9]{10,15}$/.test(rawNumber);
        if (!isValidPhone) {
            return sendResponse('Nomor tidak valid. Pastikan hanya angka tanpa spasi/simbol.');
        }
    
        const number = `${rawNumber}@s.whatsapp.net`;
    
        addUser(number, day);
        return sendResponse(`Berhasil! Nomor ${number} kini telah menjadi pengguna premium selama ${day} hari.`);
    };
    
    const handleDelPrem = (args) => {
        let rawNumber = args[1];
    
        if (!rawNumber) {
            return sendResponse('Format pesan salah. Gunakan: delprem nomor');
        }
    
        if (rawNumber.startsWith('@')) {
            rawNumber = rawNumber.slice(1);
        }
    
        const isValidPhone = /^[0-9]{10,15}$/.test(rawNumber);
        if (!isValidPhone) {
            return sendResponse('Nomor tidak valid. Pastikan hanya angka tanpa spasi/simbol.');
        }
    
        const number = `${rawNumber}@s.whatsapp.net`;
    
        deleteUser(number);
        return sendResponse(`Berhasil! Nomor ${number} telah dihapus dari list premium.`);
    };
    
    
    const handleEditPrem = (args) => {
        let rawNumber = args[1];
        const day = args[2];
    
        if (!rawNumber || !day) {
            return sendResponse('Format pesan salah. Gunakan: editprem nomor hari');
        }
    
        if (rawNumber.startsWith('@')) {
            rawNumber = rawNumber.slice(1);
        }
    
        const isValidPhone = /^[0-9]{10,15}$/.test(rawNumber);
        if (!isValidPhone) {
            return sendResponse('Nomor tidak valid. Pastikan hanya angka tanpa spasi/simbol.');
        }
    
        const number = `${rawNumber}@s.whatsapp.net`;
    
        editUser(number, day);
        return sendResponse(`Berhasil! Nomor ${number} kini telah diubah menjadi pengguna premium selama ${day} hari.`);
    };
    
    
    const handleResetData = () => {
        resetUsersJson();
        return sendResponse('Berhasil! Seluruh data users telah direset.');
    };
    
    if (lowerCaseMessage.startsWith('addprem')) {
        if (!isOwner(sender)) {
            return sendResponse(config.notification.only_owner);
        }
        const args = lowerCaseMessage.split(' ');
        return handleAddPrem(args);
    }
    
    if (lowerCaseMessage.startsWith('delprem')) {
        if (!isOwner(sender)) {
            return sendResponse(config.notification.only_owner);
        }
        const args = lowerCaseMessage.split(' ');
        return handleDelPrem(args);
    }
    
    if (lowerCaseMessage.startsWith('editprem')) {
        if (!isOwner(sender)) {
            return sendResponse(config.notification.only_owner);
        }
        const args = lowerCaseMessage.split(' ');
        return handleEditPrem(args);
    }
    
    if (lowerCaseMessage.startsWith('resetdata')) {
        if (!isOwner(sender)) {
            return sendResponse(config.notification.only_owner);
        }
        return handleResetData();
    }
    

    const greetings = ['halo', 'p', 'hay', 'hai', 'bot','ai'];
    const greetingResponses = [
        `Halo! Perkenalkan saya ${config.name_bot}, ada yang bisa saya bantu?`,
        `Hai, saya ${config.name_bot}. Bagaimana saya bisa membantu Anda hari ini?`,
        `Halo! ${config.name_bot} di sini, ada yang bisa saya bantu?`,
        `Salam! Saya ${config.name_bot}, siap membantu Anda.`,
        `Hai! ${config.name_bot} di sini, butuh bantuan?`
    ];


    const responses = {
        menu: await displayMenu(sender),
        limit: await checkLimit(sender),
        tiktok: config.notification.tt
    };
    
    const aliases = {
        menu: ['menu', 'allmenu'],
        tiktok: ['tiktok'],
    };
    let messageText = String(lowerCaseMessage).replace(/^[.#]/, '');
    
    for (const key in aliases) {
        if (aliases[key].includes(messageText)) {
            return {
                status: true,
                message_type: 'text',
                reply_text: responses[key],
            };
        }
    }


    
    const identityQuestions = ['nama kamu siapa', 'siapa kamu', 'apakah kamu bot','kamu siapa', 'ap kamu bot'];
    const identityResponses = [
        `Saya adalah AI sederhana bernama ${config.name_bot}.`,
        `Nama saya ${config.name_bot}, saya di sini untuk membantu Anda.`,
        `Saya ${config.name_bot}, bot sederhana yang siap membantu.`,
        `Panggil saya ${config.name_bot}, saya adalah asisten virtual Anda.`,
        `Hai, saya ${config.name_bot}, bot yang dibuat untuk membantu Anda.`
    ];

    const owner = ['owner', 'pembuat', 'pencipta'];
    const ownerResponses = [
        `Bot ini dibuat oleh tim di ${config.owner_website}.`,
        `Owner saya adalah ${config.owner_name}, Anda bisa cek lebih lanjut di ${config.owner_website}.`,
        `Bot ini diciptakan oleh ${config.owner_name}, kunjungi ${config.owner_website} untuk info lebih lanjut.`,
        `Saya diciptakan oleh ${config.owner_name}, kunjungi situsnya di ${config.owner_website}.`,
        `Pembuat saya adalah ${config.owner_name}, lebih banyak info di ${config.owner_website}.`
    ];


    const stickers = ['s', 'sticker', 'stiker', 'stikker'];
    const stickerResponses = [
        `Hai! Saya bisa bantu buatkan sticker khusus untuk Anda. Yuk, kirimkan gambarnya dan saya akan segera memprosesnya! 😄`,
        `Ingin sticker keren? Silakan kirim gambar Anda, dan saya akan buatkan stickernya! 😉`,
        `Sticker yang unik hanya untuk Anda! Kirim gambarnya dan saya akan jadikan sticker dalam sekejap! 🎨`,
        `Buat sticker dari gambar Anda? Mudah! Kirim gambarnya, saya siap membuat sticker untuk Anda! 👍`
    ];

    
    const songQuestion = ['bisa carikan lagu', 'apa bisa putar music','bisa play','apakah bisa putar lagu','apakah bisa mutar lagu'];
    const songQuestionResponses = [
        `Tentu Saya bisa mencarikan anda lagu. Silakan tulis judulnya`,
    ];
    if (songQuestion.some(keyword => lowerCaseMessage.includes(keyword))) {
        updateSession(sender, 'play');
        const randomsongQuestionResponses = songQuestionResponses[Math.floor(Math.random() * songQuestionResponses.length)];
        return {
            status : true,
            message_type : 'text',
            reply_text : randomsongQuestionResponses
        };
    }


    const songs = ['lagu', 'music', 'musik', 'sound', 'mp3', 'play', 'putarkan', 'putar','mutar'];
    const containsMusicKeyword = songs.some(keyword => lowerCaseMessage.includes(keyword));
    let keyword_music = '';
    if (containsMusicKeyword) {

        // Cek sesi
        const active = getActiveFitur(sender, "play");
        if(active) {
            return {
                status : true,
                message_type : 'text',
                reply_text : config.notification.waiting,
            };
        }
        setActiveFitur(sender, "play");

        reduceLimit(sender)


        keyword_music = songs.find(keyword => lowerCaseMessage.includes(keyword));
        const cleanedMessage = songs.reduce((message, keyword) => message.replace(new RegExp(keyword, 'gi'), '').trim(), lowerCaseMessage);
        keyword_music = cleanedMessage;
        keyword_music = keyword_music.replace(/carikan|cari|tolong/g, '').trim();
        if(keyword_music.length < 3) {
            return {
                status : true,
                message_type : 'text',
                reply_text : `Hai kak lagu apa yang ingin kamu dengar ? \n\nContoh : *play kangen band terbang*`,
            };
        }
        return {
            status : true,
            message_type : 'text',
            reply_text : `Mohon Tunggu Sebentar ya kak 😉, Saya akan mencarikan lagu *${keyword_music}*`,
            action : {
                content : keyword_music,
                features : 'play'
            }
        };
    }



    //  Deteck Link
    const detected = detectLink(content);
    if (detected) {

        // Cek sesi
        const active = getActiveFitur(sender, "download");
        if(active) {
            return {
                status : true,
                message_type : 'text',
                reply_text : config.notification.waiting,
            };
        }
        setActiveFitur(sender, "download");

        reduceLimit(sender)


        const responses = [
            `Sepertinya kamu mengirimkan sebuah link, saya akan coba memprosesnya.`,
            `Saya melihat ada link di pesanmu. Sedang diproses...`,
            `Oh, ada link nih! Saya akan coba cek lebih lanjut.`,
            `Terima kasih, saya menemukan sebuah link, mari kita lihat.`,
            `Link terdeteksi! Sedang saya proses ya...`
        ];
        return {
            status: true,
            message_type: 'text',
            reply_text: responses[Math.floor(Math.random() * responses.length)],
            action : {
                content     : detected.link,
                name        : detected.name,
                features    : 'detect_link'
            }
        };
    }

    // Qc Stick
    if (lowerCaseMessage.startsWith('qc')) { // Cek jika pesan dimulai dengan 'qc'
        let ppnyauser;
        try {
            // Coba mendapatkan foto profil pengguna
            ppnyauser = await sock.profilePictureUrl(sender, 'image');
        } catch (e) {
            ppnyauser = 'https://telegra.ph/file/6880771a42bad09dd6087.jpg';
        }
        const text = lowerCaseMessage.slice(2).trim();

        if(!text) {
            return {
                status: true,
                message_type: 'text',
                reply_text: config.notification.qc_help
            };
        }
    
        try {
            const media = await api.getBuffer('/api/maker/qc', { 
                name: pushName, 
                text: text, // Fallback jika teks kosong
                pp: ppnyauser 
            });
    
            return {
                status: true,
                message_type: 'sticker',
                image_url: media
            };
        } catch (error) {
            return {
                status: true,
                message_type: 'text',
                reply_text: config.error.qc
            };
        }
    }


    if (lowerCaseMessage.startsWith('brat')) {
        const text = lowerCaseMessage.slice(5).trim(); // Buang 'brat ' dari awal pesan
    
        if (!text) {
            return {
                status: true,
                message_type: 'text',
                reply_text: 'Contoh: brat resbot'
            };
        }
    
        try {
            const media = await api.getBuffer('/api/maker/brat', { 
                name: pushName, 
                text: text,
            });
    
            return {
                status: true,
                message_type: 'sticker',
                image_url: media
            };
        } catch (error) {
            return {
                status: true,
                message_type: 'text',
                reply_text: 'yah error nih bikin brat'
            };
        }
    }
    
    

    // Handle Sticker
    const stickerCommands = ['.s', 's', 'sticker','stiker', '.sticker', '.stiker', '.stick'];
    if ((messageType == 'imageMessage' || messageType == 'videoMessage') && stickerCommands.includes(lowerCaseMessage)) {
        const media = await downloadAndSaveMedia(message, sock, logger);
            return {
                status : true,
                message_type : 'sticker',
                image_url : media.buffer 
            };
    }


    if (isQuoted && ['sticker', 'stiker', 'stikker'].some(keyword => lowerCaseMessage.includes(keyword))) {

            const media = await downloadQuotedMedia(message);
                return {
                    status : true,
                    message_type : 'sticker',
                    image_url : media.buffer 
                };
        }

    

    
    // Salam
    if (greetings.includes(lowerCaseMessage)) {
        const randomGreetingResponse = greetingResponses[Math.floor(Math.random() * greetingResponses.length)];
        return {
            status : true,
            message_type : 'text',
            reply_text : randomGreetingResponse
        };
    }
    if (identityQuestions.some(keyword => lowerCaseMessage.includes(keyword))) {
        const randomIdentityResponse = identityResponses[Math.floor(Math.random() * identityResponses.length)];
        return {
            status : true,
            message_type : 'text',
            reply_text : randomIdentityResponse
        };
    }
    // Owner
    if (owner.some(keyword => lowerCaseMessage.includes(keyword))) {
        const randomOwnerResponse = ownerResponses[Math.floor(Math.random() * ownerResponses.length)];
        return {
            status : true,
            message_type : 'text',
            reply_text : randomOwnerResponse
        };
    }

    // Lebih kecil 2 karater
    if(lowerCaseMessage.length < 2) {
        const randomGreetingResponse = greetingResponses[Math.floor(Math.random() * greetingResponses.length)];
        return {
            status : true,
            message_type : 'text',
            reply_text : randomGreetingResponse
        };
    }


    // Handle Remini Response
    const reminiQuestion = ['hd', 'remini', 'jernih', 'clear', 'hdr'];
    const reminiQuestionResponses = [
        `Tentu saja! Saya bisa membantu menjernihkan gambar Anda. Silakan kirim gambarnya.`,
        `Siap! Kirimkan gambarnya, dan saya akan menjernihkannya untuk Anda.`,
        `Saya bisa membuat gambar Anda lebih jernih. Silakan kirim sekarang!`,
        `Kirimkan gambarnya, dan saya akan membantu membuatnya lebih tajam dan jelas.`,
        `Gambar buram? Tidak masalah! Kirimkan, dan saya akan segera menjernihkannya.`,
        `Ingin gambar lebih jernih? Kirim saja, saya siap membantu!`,
        `Yuk, kirim gambarnya dan saya akan menjadikannya lebih jelas dan tajam.`,
        `Gambar buram? Serahkan pada saya. Silakan kirim gambarnya untuk dijernihkan.`,
        `Saya siap membantu menjernihkan gambar Anda. Kirim gambarnya kapan saja.`,
        `Kirimkan gambarnya, dan saya akan membuatnya lebih jernih dengan segera!`,
    ];
    if (reminiQuestion.some(keyword => lowerCaseMessage.includes(keyword)) && messageType !== 'imageMessage') {
        updateSession(sender, 'remini');
        const randomResponse = reminiQuestionResponses[Math.floor(Math.random() * reminiQuestionResponses.length)];
        return {
            status: true,
            message_type: 'text',
            reply_text: randomResponse 
        };
    }

    // Hdr
    if (messageType === 'imageMessage') {
        const keywords = ['hd', 'remini', 'jernih', 'clear','hdr']; // Tambahkan kata kunci lain di sini
        const containsKeyword = keywords.some(keyword => lowerCaseMessage.includes(keyword));
        const media = await downloadAndSaveMedia(message, sock, logger);
        if (containsKeyword || (session && session.action === 'remini')) {
            const responses = [
                'Tunggu sebentar ya, kak. Saya akan coba membuat gambar itu jadi lebih jernih.',
                'Baik, kak! Sedang diproses untuk memperjelas gambar ini.',
                'Sabar ya, kak! Saya sedang mencoba memperbaiki gambar tersebut agar lebih tajam.',
                'Proses peningkatan kualitas gambar sedang berjalan. Silakan tunggu beberapa saat, kak.',
                'Saya sedang bekerja untuk membuat gambar ini lebih HD. Tunggu sebentar ya, kak!'
            ];


            // Cek sesi
            const active = getActiveFitur(sender, "hd");
            if(active) {
                return {
                    status : true,
                    message_type : 'text',
                    reply_text : config.notification.waiting,
                };
            }
            setActiveFitur(sender, "hd");

            reduceLimit(sender)

            const randomIndex = Math.floor(Math.random() * responses.length);
           
            return {
                status: true,
                message_type: 'text',
                reply_text: responses[randomIndex],
                action : {
                    content : media,
                    features : 'hd'
                }
            };
        }
    }
    

    // Handle carikan
    if (
        lowerCaseMessage.startsWith('pin') ||
        ['cari', 'gambar'].some(keyword => lowerCaseMessage.includes(keyword))
      ) {
        const keyword_image = lowerCaseMessage
            .replace(/carikan|cari|kirimkan|kirim|bisa|foto|tolong|berikan|mohon|pin|gambar|image/g, '')
            .trim();

        if (keyword_image) {

            // Cek sesi
            const active = getActiveFitur(sender, "pin");
            if(active) {
                return {
                    status : true,
                    message_type : 'text',
                    reply_text : config.notification.waiting,
                };
            }
            setActiveFitur(sender, "pin");
            reduceLimit(sender)

            return {
                status: true,
                message_type: 'text',
                reply_text: `Mohon Tunggu Sebentar ya kak 😉, Saya akan mencarikan gambar *${keyword_image}*`,
                action: {
                    content: keyword_image,
                    features: 'pin'
                }
            };
        }
    }
    
    // Sticker
    if (messageType == 'imageMessage' || messageType == 'videoMessage') {
        if (stickers.some(keyword => lowerCaseMessage.includes(keyword))) {
            const media = await downloadAndSaveMedia(message, sock, logger);
            return {
                status : true,
                message_type : 'sticker',
                image_url : media.buffer
            };
        }
    }

    // Make stiker with session
    if ((messageType == 'imageMessage' || messageType == 'videoMessage') && session) {
        const session = getSession(sender);
        if(session.action == 'sticker') {
            updateSession(sender, 'sticker');
            const media = await downloadAndSaveMedia(message, sock, logger);
                return {
                    status : true,
                    message_type : 'sticker',
                    image_url : media.buffer
                };
        }
    }

    // Sticker
    if (['sticker', 'stiker', 'stikker'].some(keyword => lowerCaseMessage.includes(keyword))) {
        updateSession(sender, 'sticker');
        return {
            status : true,
            message_type : 'text',
            reply_text : stickerResponses[Math.floor(Math.random() * stickerResponses.length)]
        };
    }

     // Images Recieved
    if (messageType === 'imageMessage') {
        const responses = [
            'Hai, apa yang bisa saya bantu dengan gambar itu?',
            'Gambar yang menarik! Ada yang bisa saya lakukan?',
            'Terima kasih atas gambar tersebut, apa yang ingin kamu lakukan selanjutnya?',
            'Hmm, gambar ini terlihat keren! Ada permintaan khusus?',
            'Gambar diterima! Apa yang perlu saya lakukan dengan itu?'
        ];
    
        const randomIndex = Math.floor(Math.random() * responses.length);
        return {
            status: true,
            message_type: 'text',
            reply_text: responses[randomIndex]
        };
    }
    
    return null;
}

async function handleMessageExternal(content, sock, sender, remoteJid, messageType, session, message) {
    try {
        reduceLimit(sender)
        const replyText = await GEMINI_TEXT(sender, content);
        return {
            status: true,
            message_type: 'text',
            reply_text: replyText
        };
    } catch (error) {
        return {
            status: false,
            message_type: 'error',
            reply_text: 'Something went wrong while processing the message.'
        };
    }
}


async function createRule(aiResponse) {
    return {
        message_type: aiResponse.message_type || null,
        reply_text: aiResponse.reply_text || null,
        image_url: aiResponse.image_url || null,
        footer: aiResponse.footer || null,
        button_data: aiResponse.button_data || null,
        action : aiResponse.action || null
    };
}

async function processMessage(content, sock, sender, remoteJid, message, messageType, pushName, isQuoted) {
    const session = getSession(sender);

    const AiInternal = await handleMessageLocal(content, sock, sender, remoteJid, messageType, session, message, pushName, isQuoted);
    let rule_;

    if (AiInternal && AiInternal.status) {
        rule_ = await createRule(AiInternal);
    }

    if(!AiInternal) {
       try {
        await sock.sendPresenceUpdate("composing", remoteJid); // efek mengetik
       } catch (error) {
        console.log('ERROR :',error)
       }

        const AiExternal = await handleMessageExternal(content, sock, sender, remoteJid, messageType, session, message);
        if(AiExternal && AiExternal.status) {
            rule_ = await createRule(AiExternal);
        }else {
            return console.log('Error Gemini, Periksa Apikey Gemini Anda')
        }
    }


    const sock_global = global.sock;
    return await sendReply(sock_global, remoteJid, rule_, message);
}

module.exports = { processMessage };
