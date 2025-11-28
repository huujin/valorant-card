const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Настройка статических файлов
app.use(express.static(path.join(__dirname, 'public')));

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Карты Valorant
const valorantMaps = [
    { id: 'abyss', name: 'Abyss', icon: '🏔️' },
    { id: 'ascent', name: 'Ascent', icon: '🏛️' },
    { id: 'bind', name: 'Bind', icon: '🏜️' },
    { id: 'corrode', name: 'Corrode', icon: '🏭' },
    { id: 'haven', name: 'Haven', icon: '🛕' },
    { id: 'icebox', name: 'Icebox', icon: '❄️' },
    { id: 'lotus', name: 'Lotus', icon: '🪷' },
    { id: 'pearl', name: 'Pearl', icon: '🐚' },
    { id: 'sunset', name: 'Sunset', icon: '🌇' }
];

// Состояние игры
let gameState = {
    currentPlayer: 1,
    cards: [...valorantMaps],
    removedCards: [],
    gameActive: false,
    players: {},
    captains: {},
    tournamentPlayers: {},
    lastCard: false
};

io.on('connection', (socket) => {
    console.log('Новый игрок подключился:', socket.id);
    
    // Отправляем текущее состояние новому игроку
    socket.emit('gameState', gameState);
    socket.emit('playersUpdate', gameState.players);
    socket.emit('captainsUpdate', gameState.captains);
    socket.emit('tournamentUpdate', gameState.tournamentPlayers);

    // Обработка присоединения к игре
    socket.on('joinGame', (data) => {
        const nickname = data.nickname;
        const deviceId = data.deviceId;
        
        // Назначаем номер игрока (теперь все начинают как обычные игроки)
        const playerNumbers = Object.values(gameState.players).map(p => p.playerNumber);
        let playerNumber = 0;
        
        // Находим свободный номер игрока
        for (let i = 1; i <= Object.keys(gameState.players).length + 1; i++) {
            if (!playerNumbers.includes(i)) {
                playerNumber = i;
                break;
            }
        }
        
        gameState.players[socket.id] = { 
            id: socket.id,
            nickname, 
            playerNumber, 
            isCaptain: false,
            deviceId: deviceId,
            ready: true 
        };

        // Проверяем, был ли игрок зарегистрирован в турнире с этого устройства
        let isInTournament = false;
        if (deviceId) {
            const existingTournamentPlayer = Object.values(gameState.tournamentPlayers).find(
                p => p.deviceId === deviceId
            );
            if (existingTournamentPlayer) {
                // Обновляем ID подключения для существующего игрока турнира
                existingTournamentPlayer.id = socket.id;
                existingTournamentPlayer.nickname = nickname;
                isInTournament = true;
            }
        }
        
        console.log(`Игрок ${socket.id} (${nickname}) присоединился как Игрок ${playerNumber}`);
        
        // Отправляем данные игроку
        socket.emit('playerAssigned', { 
            playerNumber, 
            isCaptain: false,
            isInTournament: isInTournament
        });
        
        // Уведомляем всех об обновлении
        io.emit('playersUpdate', gameState.players);
        io.emit('captainsUpdate', gameState.captains);
        io.emit('tournamentUpdate', gameState.tournamentPlayers);
    });
    
    // Обработка запроса стать капитаном
    socket.on('becomeCaptain', () => {
        const player = gameState.players[socket.id];
        
        if (!player) {
            socket.emit('error', 'Сначала присоединитесь к игре');
            return;
        }
        
        if (Object.keys(gameState.captains).length >= 2) {
            socket.emit('error', 'Достигнут лимит капитанов (2)');
            return;
        }
        
        if (gameState.captains[socket.id]) {
            socket.emit('error', 'Вы уже капитан');
            return;
        }
        
        // Назначаем игрока капитаном
        player.isCaptain = true;
        gameState.captains[socket.id] = {
            id: socket.id,
            nickname: player.nickname,
            playerNumber: player.playerNumber
        };
        
        console.log(`Игрок ${player.nickname} стал капитаном`);
        
        // Уведомляем всех об обновлении
        io.emit('playersUpdate', gameState.players);
        io.emit('captainsUpdate', gameState.captains);
        
        // Активируем игру если есть два капитана
        if (Object.keys(gameState.captains).length >= 2 && !gameState.gameActive) {
            gameState.gameActive = true;
            gameState.currentPlayer = 1;
            io.emit('gameState', gameState);
            console.log('Игра активирована, два капитана готовы');
        }
    });

    // Обработка запроса перестать быть капитаном
    socket.on('leaveCaptain', () => {
        const player = gameState.players[socket.id];
        
        if (!player || !player.isCaptain) {
            socket.emit('error', 'Вы не являетесь капитаном');
            return;
        }
        
        // Убираем игрока из капитанов
        player.isCaptain = false;
        delete gameState.captains[socket.id];
        
        console.log(`Игрок ${player.nickname} перестал быть капитаном`);
        
        // Останавливаем игру если капитанов стало меньше 2
        if (Object.keys(gameState.captains).length < 2 && gameState.gameActive) {
            gameState.gameActive = false;
            console.log('Игра приостановлена: недостаточно капитанов');
        }
        
        // Уведомляем всех об обновлении
        io.emit('playersUpdate', gameState.players);
        io.emit('captainsUpdate', gameState.captains);
        io.emit('gameState', gameState);
    });

    // Обработка смены никнейма
    socket.on('changeNickname', (newNickname) => {
        const player = gameState.players[socket.id];
        
        if (!player) {
            socket.emit('error', 'Сначала присоединитесь к игре');
            return;
        }
        
        const oldNickname = player.nickname;
        player.nickname = newNickname;
        
        // Обновляем никнейм в списке капитанов если игрок капитан
        if (gameState.captains[socket.id]) {
            gameState.captains[socket.id].nickname = newNickname;
        }
        
        // Обновляем никнейм в списке турнира если игрок участвует
        if (gameState.tournamentPlayers[socket.id]) {
            gameState.tournamentPlayers[socket.id].nickname = newNickname;
        }
        
        console.log(`Игрок ${oldNickname} сменил никнейм на ${newNickname}`);
        
        // Уведомляем всех об обновлении
        io.emit('playersUpdate', gameState.players);
        io.emit('captainsUpdate', gameState.captains);
        io.emit('tournamentUpdate', gameState.tournamentPlayers);
        
        // Уведомляем самого игрока об успешной смене
        socket.emit('nicknameChanged', { newNickname });
        
        // Уведомляем других игроков
        socket.broadcast.emit('info', `Игрок ${oldNickname} сменил никнейм на ${newNickname}`);
    });

    // Обработка регистрации на турнир
    socket.on('joinTournament', (deviceId) => {
        const player = gameState.players[socket.id];
        
        if (!player) {
            socket.emit('error', 'Сначала присоединитесь к игре');
            return;
        }
        
        // Проверяем, не зарегистрирован ли уже с этого устройства
        if (deviceId) {
            const existingPlayer = Object.values(gameState.tournamentPlayers).find(
                p => p.deviceId === deviceId
            );
            if (existingPlayer) {
                socket.emit('error', 'Вы уже зарегистрированы с этого устройства');
                return;
            }
        }
        
        if (gameState.tournamentPlayers[socket.id]) {
            socket.emit('error', 'Вы уже участвуете в турнире');
            return;
        }
        
        if (Object.keys(gameState.tournamentPlayers).length >= 10) {
            socket.emit('error', 'Достигнут лимит участников (10)');
            return;
        }
        
        // Добавляем игрока в турнир
        gameState.tournamentPlayers[socket.id] = {
            id: socket.id,
            nickname: player.nickname,
            playerNumber: player.playerNumber,
            deviceId: deviceId,
            joinTime: new Date().toISOString()
        };
        
        console.log(`Игрок ${player.nickname} присоединился к турниру 5x5`);
        
        // Уведомляем всех об обновлении
        io.emit('tournamentUpdate', gameState.tournamentPlayers);
        socket.broadcast.emit('info', `${player.nickname} присоединился к турниру 5x5`);
    });

    // Обработка отмены регистрации на турнир
    socket.on('leaveTournament', (deviceId) => {
        const player = gameState.players[socket.id];
        
        if (!player) {
            socket.emit('error', 'Сначала присоединитесь к игре');
            return;
        }
        
        // Ищем игрока в турнире по deviceId или socket.id
        let tournamentPlayerId = socket.id;
        if (deviceId) {
            const playerByDevice = Object.entries(gameState.tournamentPlayers).find(
                ([id, p]) => p.deviceId === deviceId
            );
            if (playerByDevice) {
                tournamentPlayerId = playerByDevice[0];
            }
        }
        
        if (!gameState.tournamentPlayers[tournamentPlayerId]) {
            socket.emit('error', 'Вы не участвуете в турнире');
            return;
        }
        
        // Удаляем игрока из турнира
        delete gameState.tournamentPlayers[tournamentPlayerId];
        
        console.log(`Игрок ${player.nickname} покинул турнир 5x5`);
        
        // Уведомляем всех об обновлении
        io.emit('tournamentUpdate', gameState.tournamentPlayers);
        socket.broadcast.emit('info', `${player.nickname} покинул турнир 5x5`);
    });

    // Обработка сброса всего состояния
    socket.on('resetAll', () => {
        // Сохраняем только tournamentPlayers (участников турнира)
        const savedTournamentPlayers = gameState.tournamentPlayers;
        
        gameState = {
            currentPlayer: 1,
            cards: [...valorantMaps],
            removedCards: [],
            gameActive: false,
            players: {},
            captains: {},
            tournamentPlayers: savedTournamentPlayers, // Сохраняем участников турнира
            lastCard: false
        };
        
        io.emit('gameState', gameState);
        io.emit('playersUpdate', gameState.players);
        io.emit('captainsUpdate', gameState.captains);
        console.log('Состояние игры сброшено, капитаны удалены');
    });

    // Обработка полного сброса (включая турнир)
    socket.on('resetTournament', () => {
        gameState = {
            currentPlayer: 1,
            cards: [...valorantMaps],
            removedCards: [],
            gameActive: false,
            players: {},
            captains: {},
            tournamentPlayers: {}, // Полностью очищаем турнир
            lastCard: false
        };
        
        io.emit('gameState', gameState);
        io.emit('playersUpdate', gameState.players);
        io.emit('captainsUpdate', gameState.captains);
        io.emit('tournamentUpdate', gameState.tournamentPlayers);
        console.log('Полный сброс: турнир и капитаны очищены');
    });
    
    // Обработка удаления карты
    socket.on('removeCard', (cardId) => {
        if (!gameState.gameActive) return;
        
        const player = gameState.players[socket.id];
        if (!player || !player.isCaptain) {
            socket.emit('error', 'Только капитаны могут удалять карты!');
            return;
        }
        
        if (player.playerNumber !== gameState.currentPlayer) {
            socket.emit('error', 'Сейчас не ваш ход!');
            return;
        }
        
        const cardIndex = gameState.cards.findIndex(card => card.id === cardId);
        if (cardIndex === -1) {
            socket.emit('error', 'Карта уже удалена!');
            return;
        }
        
        // Удаляем карту
        const removedCard = { ...gameState.cards[cardIndex] };
        removedCard.removedBy = gameState.currentPlayer;
        
        gameState.removedCards.push(removedCard);
        gameState.cards.splice(cardIndex, 1);
        
        // Проверяем, осталась ли последняя карта
        if (gameState.cards.length === 1) {
            gameState.lastCard = true;
            gameState.gameActive = false;
            console.log('Осталась последняя карта! Игра завершена.');
        } else if (gameState.cards.length === 0) {
            gameState.gameActive = false;
            gameState.lastCard = false;
        } else {
            // Меняем игрока только если игра продолжается
            gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
        }
        
        // Рассылаем обновление всем клиентам
        io.emit('gameState', gameState);
        console.log(`Капитан ${player.nickname} удалил карту: ${removedCard.name}`);
    });
    
    // Обработка сброса игры
    socket.on('resetGame', () => {
        gameState = {
            currentPlayer: 1,
            cards: [...valorantMaps],
            removedCards: [],
            gameActive: Object.keys(gameState.captains).length >= 2,
            players: gameState.players,
            captains: gameState.captains,
            tournamentPlayers: gameState.tournamentPlayers,
            lastCard: false
        };
        
        io.emit('gameState', gameState);
        console.log('Игра сброшена');
    });
    
    // Обработка отключения игрока
    socket.on('disconnect', () => {
        console.log('Игрок отключился:', socket.id);
        
        const player = gameState.players[socket.id];
        
        // Удаляем игрока из всех списков, кроме турнира
        delete gameState.players[socket.id];
        delete gameState.captains[socket.id];
        // Игрок остается в tournamentPlayers даже после дисконнекта
        
        // Если осталось меньше 2 капитанов, останавливаем игру
        if (Object.keys(gameState.captains).length < 2 && gameState.gameActive) {
            gameState.gameActive = false;
            console.log('Игра приостановлена: недостаточно капитанов');
        }
        
        // Уведомляем всех об обновлении
        io.emit('playersUpdate', gameState.players);
        io.emit('captainsUpdate', gameState.captains);
        io.emit('gameState', gameState);
        
        console.log(`Осталось игроков: ${Object.keys(gameState.players).length}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});