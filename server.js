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
    gameActive: true,
    players: {},
    lastCard: false
};

io.on('connection', (socket) => {
    console.log('Новый игрок подключился:', socket.id);
    
    // Назначаем номер игрока (1 или 2)
    const playerNumbers = Object.values(gameState.players).map(p => p.playerNumber);
    const playerNumber = !playerNumbers.includes(1) ? 1 : !playerNumbers.includes(2) ? 2 : 0;
    
    gameState.players[socket.id] = { playerNumber, ready: true };
    
    console.log(`Игрок ${socket.id} назначен как Игрок ${playerNumber}`);
    
    // Отправляем состояние игры новому игроку
    socket.emit('gameState', gameState);
    socket.emit('playerAssigned', playerNumber);
    
    // Уведомляем всех об обновлении
    io.emit('playersUpdate', Object.values(gameState.players).filter(p => p.playerNumber > 0).length);
    
    // Обработка удаления карты
    socket.on('removeCard', (cardId) => {
        if (!gameState.gameActive) return;
        
        const playerNum = gameState.players[socket.id]?.playerNumber;
        if (playerNum !== gameState.currentPlayer) {
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
        console.log(`Игрок ${playerNum} удалил карту: ${removedCard.name}`);
    });
    
    // Обработка сброса игры
    socket.on('resetGame', () => {
        gameState = {
            currentPlayer: 1,
            cards: [...valorantMaps],
            removedCards: [],
            gameActive: true,
            players: gameState.players,
            lastCard: false
        };
        
        io.emit('gameState', gameState);
        console.log('Игра сброшена');
    });
    
    // Обработка отключения игрока
    socket.on('disconnect', () => {
        console.log('Игрок отключился:', socket.id);
        delete gameState.players[socket.id];
        
        const activePlayers = Object.values(gameState.players).filter(p => p.playerNumber > 0).length;
        io.emit('playersUpdate', activePlayers);
        
        console.log(`Осталось игроков: ${activePlayers}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});