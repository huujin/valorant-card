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
    lastCard: false
};

io.on('connection', (socket) => {
    console.log('Новый игрок подключился:', socket.id);
    
    // Отправляем текущее состояние новому игроку
    socket.emit('gameState', gameState);
    socket.emit('playersUpdate', gameState.players);
    socket.emit('captainsUpdate', gameState.captains);

    // Обработка присоединения к игре
    socket.on('joinGame', (nickname) => {
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
            isCaptain: false, // Все начинают не капитанами
            ready: true 
        };
        
        console.log(`Игрок ${socket.id} (${nickname}) присоединился как Игрок ${playerNumber}`);
        
        // Отправляем данные игроку
        socket.emit('playerAssigned', { playerNumber, isCaptain: false });
        
        // Уведомляем всех об обновлении
        io.emit('playersUpdate', gameState.players);
        io.emit('captainsUpdate', gameState.captains);
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
    // Добавьте этот обработчик в server.js после обработчика leaveCaptain
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
    
    console.log(`Игрок ${oldNickname} сменил никнейм на ${newNickname}`);
    
    // Уведомляем всех об обновлении
    io.emit('playersUpdate', gameState.players);
    io.emit('captainsUpdate', gameState.captains);
    
    // Уведомляем самого игрока об успешной смене
    socket.emit('nicknameChanged', { newNickname });
    
    // Уведомляем других игроков
    socket.broadcast.emit('info', `Игрок ${oldNickname} сменил никнейм на ${newNickname}`);
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
            lastCard: false
        };
        
        io.emit('gameState', gameState);
        console.log('Игра сброшена');
    });
    
    // Обработка отключения игрока
    socket.on('disconnect', () => {
        console.log('Игрок отключился:', socket.id);
        
        // Удаляем игрока из всех списков
        delete gameState.players[socket.id];
        delete gameState.captains[socket.id];
        
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