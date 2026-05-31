/* ═══════════════════════════════════════════════════════════════════════════
   Chess Arena — client.js
   Full game logic: Socket.io, chess.js, Drag & Drop, Chat, UI
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── Socket connection ────────────────────────────────────────────────────────
const socket = io();

// ── Game State ───────────────────────────────────────────────────────────────
let chess          = null;   // chess.js instance
let myColor        = null;   // 'white' | 'black'
let roomId         = null;
let selectedSquare = null;
let legalMoves     = [];
let lastMove       = null;
let gameOver       = false;
let dragPiece      = null;   // { from, pieceChar }
let pendingPromo   = null;   // { from, to } awaiting piece choice

// ── Piece Unicode Map ────────────────────────────────────────────────────────
const PIECES = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
};
const pieceChar = (p) => PIECES[p.color[0] + p.type.toUpperCase()];

// ── Quick Chat Messages ───────────────────────────────────────────────────────
const QUICK_MSGS = [
  '👋 مرحبًا!',
  '🤔 فكّر جيداً...',
  '😈 خطوة شريرة!',
  '😅 اوه لا!',
  '👏 تحرك رائع!',
  '🏳 أستسلم ذهنياً',
  '🎯 في الفخ أنت!',
  '😂 هاهاها!',
  '🔥 ساخن جداً!',
  '🤝 مباراة جيدة'
];

// ═══════════════════════════════════════════════════════════════════════════════
// DOM HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(name + '-screen').classList.add('active');
}

function toast(msg, type = 'info', duration = 3000) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => {
    t.classList.add('exit');
    t.addEventListener('animationend', () => t.remove());
  }, duration);
}

function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

// ═══════════════════════════════════════════════════════════════════════════════
// BOARD RENDERING
// ═══════════════════════════════════════════════════════════════════════════════
const FILES = ['a','b','c','d','e','f','g','h'];
const RANKS = ['8','7','6','5','4','3','2','1'];

function buildBoard() {
  const board = document.getElementById('chess-board');
  board.innerHTML = '';

  // Labels
  const lleft = document.getElementById('rank-labels-left');
  const lright = document.getElementById('rank-labels-right');
  const lfile = document.getElementById('file-labels');
  lleft.innerHTML = lright.innerHTML = lfile.innerHTML = '';

  const ranks = myColor === 'black' ? [...RANKS].reverse() : RANKS;
  const files = myColor === 'black' ? [...FILES].reverse() : FILES;

  ranks.forEach(r => {
    ['rank-labels-left','rank-labels-right'].forEach(id => {
      const s = document.createElement('span');
      s.textContent = r;
      document.getElementById(id).appendChild(s);
    });
  });
  files.forEach(f => {
    const s = document.createElement('span');
    s.textContent = f;
    lfile.appendChild(s);
  });

  ranks.forEach(rank => {
    files.forEach(file => {
      const sq = document.createElement('div');
      const sqName = file + rank;
      const fileIdx = FILES.indexOf(file);
      const rankIdx = parseInt(rank) - 1;
      const isLight = (fileIdx + rankIdx) % 2 === 1;
      sq.className = `square ${isLight ? 'light' : 'dark'}`;
      sq.dataset.square = sqName;

      // Drag & Drop events
      sq.addEventListener('dragover', onDragOver);
      sq.addEventListener('dragleave', onDragLeave);
      sq.addEventListener('drop', onDrop);
      sq.addEventListener('click', onSquareClick);

      board.appendChild(sq);
    });
  });

  renderPieces();
}

function renderPieces() {
  if (!chess) return;
  const board = document.getElementById('chess-board');

  // Clear all pieces
  board.querySelectorAll('.piece').forEach(p => p.remove());

  // Remove highlights first
  board.querySelectorAll('.square').forEach(sq => {
    sq.classList.remove('selected', 'legal-move', 'legal-capture', 'last-move', 'in-check');
  });

  // Last move highlight
  if (lastMove) {
    const fromSq = board.querySelector(`[data-square="${lastMove.from}"]`);
    const toSq   = board.querySelector(`[data-square="${lastMove.to}"]`);
    if (fromSq) fromSq.classList.add('last-move');
    if (toSq)   toSq.classList.add('last-move');
  }

  // Selected + legal moves
  if (selectedSquare) {
    const selEl = board.querySelector(`[data-square="${selectedSquare}"]`);
    if (selEl) selEl.classList.add('selected');

    legalMoves.forEach(m => {
      const el = board.querySelector(`[data-square="${m.to}"]`);
      if (!el) return;
      const hasPiece = chess.get(m.to);
      el.classList.add(hasPiece ? 'legal-capture' : 'legal-move');
    });
  }

  // chess.board() returns an 8x8 array [rank8..rank1][fileA..fileH]
  // row 0 = rank 8, row 7 = rank 1 — col 0 = file a, col 7 = file h
  const board2d = chess.board();

  // Helper: get algebraic square from row/col
  function sqName(row, col) {
    return FILES[col] + (8 - row);
  }

  // King in check highlight
  if (chess.in_check()) {
    const turn = chess.turn();
    board2d.forEach((row, ri) => {
      row.forEach((p, ci) => {
        if (p && p.type === 'k' && p.color === turn) {
          const sq = board.querySelector(`[data-square="${sqName(ri, ci)}"]`);
          if (sq) sq.classList.add('in-check');
        }
      });
    });
  }

  // Place pieces
  board2d.forEach((row, ri) => {
    row.forEach((p, ci) => {
      if (!p) return;
      const sName = sqName(ri, ci);
      const sqEl = board.querySelector(`[data-square="${sName}"]`);
      if (!sqEl) return;

      const piece = document.createElement('div');
      piece.className = `piece ${p.color === 'w' ? 'white-piece' : 'black-piece'}`;
      piece.textContent = pieceChar(p);
      piece.dataset.square = sName;
      piece.dataset.color  = p.color;

      // Only allow dragging own pieces when it's our turn
      const isMyTurn  = (chess.turn() === (myColor === 'white' ? 'w' : 'b'));
      const isMyPiece = (p.color === (myColor === 'white' ? 'w' : 'b'));
      if (isMyTurn && isMyPiece && !gameOver) {
        piece.draggable = true;
        piece.addEventListener('dragstart', onDragStart);
        piece.addEventListener('dragend', onDragEnd);
      }

      sqEl.appendChild(piece);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// DRAG & DROP
// ═══════════════════════════════════════════════════════════════════════════════
let ghost = null;

function onDragStart(e) {
  const piece = e.currentTarget;
  const sq = piece.closest('.square');
  if (!sq) return;

  dragPiece = {
    from: sq.dataset.square,
    char: piece.textContent
  };

  selectedSquare = dragPiece.from;
  legalMoves = chess.moves({ square: dragPiece.from, verbose: true });
  renderPieces();

  // Create ghost
  ghost = document.createElement('div');
  ghost.id = 'drag-ghost';
  ghost.textContent = piece.textContent;
  ghost.style.display = 'block';
  document.body.appendChild(ghost);
  moveGhost(e.clientX, e.clientY);

  piece.classList.add('dragging');

  // Hide default drag image
  const blank = document.createElement('canvas');
  blank.width = blank.height = 1;
  e.dataTransfer.setDragImage(blank, 0, 0);
  e.dataTransfer.effectAllowed = 'move';
}

function onDragEnd(e) {
  if (ghost) { ghost.remove(); ghost = null; }
  dragPiece = null;
  document.querySelectorAll('.piece.dragging').forEach(p => p.classList.remove('dragging'));
}

document.addEventListener('dragover', e => {
  e.preventDefault();
  if (ghost) moveGhost(e.clientX, e.clientY);
});

function moveGhost(x, y) {
  if (!ghost) return;
  ghost.style.left = x + 'px';
  ghost.style.top  = y + 'px';
}

function onDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  const sq = e.currentTarget;
  sq.classList.remove('drag-over');
  if (!dragPiece) return;
  const to = sq.dataset.square;
  attemptMove(dragPiece.from, to);
  dragPiece = null;
  selectedSquare = null;
  legalMoves = [];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLICK-TO-MOVE
// ═══════════════════════════════════════════════════════════════════════════════
function onSquareClick(e) {
  if (gameOver) return;
  const sq = e.currentTarget;
  const sqName = sq.dataset.square;
  const piece = chess.get(sqName);

  const isMyTurn = chess.turn() === (myColor === 'white' ? 'w' : 'b');
  const isMyPiece = piece && piece.color === (myColor === 'white' ? 'w' : 'b');

  if (selectedSquare) {
    const isLegal = legalMoves.some(m => m.to === sqName);
    if (isLegal) {
      attemptMove(selectedSquare, sqName);
      selectedSquare = null;
      legalMoves = [];
      return;
    }
    if (isMyPiece && isMyTurn) {
      selectedSquare = sqName;
      legalMoves = chess.moves({ square: sqName, verbose: true });
      renderPieces();
      return;
    }
    selectedSquare = null;
    legalMoves = [];
    renderPieces();
    return;
  }

  if (isMyPiece && isMyTurn) {
    selectedSquare = sqName;
    legalMoves = chess.moves({ square: sqName, verbose: true });
    renderPieces();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOVE LOGIC
// ═══════════════════════════════════════════════════════════════════════════════
function attemptMove(from, to) {
  if (!chess || gameOver) return;

  const isMyTurn = chess.turn() === (myColor === 'white' ? 'w' : 'b');
  if (!isMyTurn) { toast('ليس دورك!', 'warn'); return; }

  const piece = chess.get(from);
  if (!piece) return;
  const isMyPiece = piece.color === (myColor === 'white' ? 'w' : 'b');
  if (!isMyPiece) { toast('لا يمكنك تحريك قطع الخصم!', 'error'); return; }

  // Check promotion
  const isPawn = piece.type === 'p';
  const isLastRank = (piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1');
  if (isPawn && isLastRank) {
    pendingPromo = { from, to };
    showPromotionModal(piece.color);
    return;
  }

  executeMove(from, to, null);
}

function executeMove(from, to, promotion) {
  const moveObj = { from, to };
  if (promotion) moveObj.promotion = promotion;

  const result = chess.move(moveObj);
  if (!result) return; // illegal move

  lastMove = { from, to };
  selectedSquare = null;
  legalMoves = [];

  renderPieces();
  updateStatusBar();
  updateCaptured();

  // Send to server
  const payload = { roomId, move: result, fen: chess.fen() };
  if (promotion) {
    socket.emit('promotion', payload);
  } else {
    socket.emit('move', payload);
  }

  checkGameEnd();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROMOTION MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function showPromotionModal(color) {
  const pieces = color === 'w'
    ? [{ t:'q', c:'♕' }, { t:'r', c:'♖' }, { t:'b', c:'♗' }, { t:'n', c:'♘' }]
    : [{ t:'q', c:'♛' }, { t:'r', c:'♜' }, { t:'b', c:'♝' }, { t:'n', c:'♞' }];

  const container = document.getElementById('promotion-choices');
  container.innerHTML = '';
  pieces.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'promo-btn';
    btn.textContent = p.c;
    btn.title = p.t;
    btn.addEventListener('click', () => {
      hideModal('promotion-modal');
      const { from, to } = pendingPromo;
      pendingPromo = null;
      executeMove(from, to, p.t);
    });
    container.appendChild(btn);
  });

  showModal('promotion-modal');
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAME END DETECTION
// ═══════════════════════════════════════════════════════════════════════════════
function checkGameEnd() {
  if (chess.game_over()) {
    gameOver = true;

    let title, sub, trophy;

    if (chess.in_checkmate()) {
      const winner = chess.turn() === 'w' ? 'الأسود' : 'الأبيض';
      const iWin   = chess.turn() !== (myColor === 'white' ? 'w' : 'b');
      trophy = iWin ? '🏆' : '😔';
      title  = iWin ? 'أنت الفائز!' : 'خسرت!';
      sub    = `الفوز لـ اللاعب ${winner} بالكش ملك`;
    } else if (chess.in_stalemate()) {
      trophy = '🤝'; title = 'تعادل!'; sub = 'لا حركات قانونية متاحة (Stalemate)';
    } else if (chess.in_draw()) {
      trophy = '🤝'; title = 'تعادل!'; sub = 'انتهت المباراة بالتعادل';
    } else if (chess.in_threefold_repetition()) {
      trophy = '🤝'; title = 'تعادل!'; sub = 'تكرار ثلاثي للوضع';
    } else {
      trophy = '🎭'; title = 'انتهت المباراة'; sub = '';
    }

    showResult(trophy, title, sub);
  }
}

function showResult(trophy, title, sub) {
  document.getElementById('result-trophy').textContent = trophy;
  document.getElementById('result-title').textContent  = title;
  document.getElementById('result-sub').textContent    = sub;
  document.getElementById('rematch-status').textContent = '';
  showModal('result-modal');
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS & CAPTURED PIECES
// ═══════════════════════════════════════════════════════════════════════════════
function updateStatusBar() {
  if (!chess) return;
  const txt = document.getElementById('status-text');
  if (chess.game_over()) {
    txt.textContent = '🏁 انتهت المباراة';
    return;
  }
  const isMyTurn = chess.turn() === (myColor === 'white' ? 'w' : 'b');
  txt.textContent = isMyTurn ? '⚔️ دورك — قم بتحريك قطعتك' : '⏳ دور منافسك...';

  document.getElementById('my-turn-dot').classList.toggle('active', isMyTurn);
  document.getElementById('opponent-turn-dot').classList.toggle('active', !isMyTurn);
}

// Track captured by both sides
function updateCaptured() {
  const startPieces = { p:8, n:2, b:2, r:2, q:1, k:1 };
  const board = chess.board();
  const onBoard = { w:{}, b:{} };

  board.forEach(row => row.forEach(p => {
    if (!p) return;
    onBoard[p.color][p.type] = (onBoard[p.color][p.type] || 0) + 1;
  }));

  const captured = { w:[], b:[] };
  Object.keys(startPieces).forEach(t => {
    const wMissing = startPieces[t] - (onBoard.w[t] || 0);
    const bMissing = startPieces[t] - (onBoard.b[t] || 0);
    for (let i=0; i<wMissing; i++) captured.w.push(PIECES['w'+t.toUpperCase()]);
    for (let i=0; i<bMissing; i++) captured.b.push(PIECES['b'+t.toUpperCase()]);
  });

  // If I'm white: my captures = black pieces captured (shown above), opponent's = white pieces
  const myCaptures    = myColor === 'white' ? captured.b : captured.w;
  const theirCaptures = myColor === 'white' ? captured.w : captured.b;

  document.getElementById('captured-by-me').textContent       = myCaptures.join(' ');
  document.getElementById('captured-by-opponent').textContent = theirCaptures.join(' ');
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT
// ═══════════════════════════════════════════════════════════════════════════════
function buildQuickChat() {
  const container = document.getElementById('quick-chat-btns');
  container.innerHTML = '';
  QUICK_MSGS.forEach(msg => {
    const btn = document.createElement('button');
    btn.className = 'quick-btn';
    btn.textContent = msg;
    btn.addEventListener('click', () => {
      socket.emit('chat_message', { roomId, message: msg, color: myColor });
    });
    container.appendChild(btn);
  });
}

function addChatBubble(msg, side) {
  const container = document.getElementById('chat-messages');
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${side}`;
  bubble.textContent = msg;
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;

  // Auto-remove after 8s
  setTimeout(() => {
    bubble.style.opacity = '0';
    bubble.style.transition = 'opacity 0.5s';
    setTimeout(() => bubble.remove(), 500);
  }, 8000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOCKET EVENTS
// ═══════════════════════════════════════════════════════════════════════════════
socket.on('room_created', ({ roomId: id, color }) => {
  roomId   = id;
  myColor  = color;

  const baseUrl = window.location.origin + window.location.pathname;
  const link = `${baseUrl}?room=${id}`;
  document.getElementById('display-room-id').textContent = id;
  document.getElementById('room-link').value = link;
  document.getElementById('room-chip').textContent = id;

  showScreen('waiting');
});

socket.on('join_error', ({ message }) => {
  const err = document.getElementById('join-error');
  err.textContent = message;
  setTimeout(() => err.textContent = '', 4000);
});

socket.on('room_joined', ({ roomId: id, color, fen }) => {
  roomId  = id;
  myColor = color;
  document.getElementById('room-chip').textContent = id;
  initGame(fen === 'start' ? null : fen);
  toast('انضممت للغرفة! أنت اللاعب الأسود ♟', 'info');
});

socket.on('opponent_joined', () => {
  toast('انضم منافسك! المباراة بدأت 🎯', 'success');
});

socket.on('game_start', ({ fen }) => {
  initGame(fen === 'start' ? null : fen);
});

socket.on('move', ({ move, fen }) => {
  if (!chess) return;
  chess.load(fen);
  lastMove = { from: move.from, to: move.to };
  selectedSquare = null;
  legalMoves = [];
  renderPieces();
  updateStatusBar();
  updateCaptured();
  checkGameEnd();
});

socket.on('promotion', ({ move, fen }) => {
  if (!chess) return;
  chess.load(fen);
  lastMove = { from: move.from, to: move.to };
  selectedSquare = null;
  legalMoves = [];
  renderPieces();
  updateStatusBar();
  updateCaptured();
  checkGameEnd();
});

socket.on('chat_message', ({ message, color }) => {
  const side = color === myColor ? 'mine' : 'theirs';
  addChatBubble(message, side);
  if (color !== myColor) toast(`💬 ${message}`, 'info', 2500);
});

socket.on('opponent_disconnected', () => {
  toast('⚠️ انقطع اتصال منافسك...', 'warn', 6000);
});

socket.on('opponent_resigned', ({ color }) => {
  gameOver = true;
  const who = color === 'white' ? 'الأبيض' : 'الأسود';
  showResult('🏳', 'استسلام!', `استسلم اللاعب ${who}. أنت الفائز!`);
});

// Rematch
socket.on('rematch_request', () => {
  document.getElementById('rematch-status').textContent = '⚔️ منافسك يريد إعادة اللعب...';
  document.getElementById('btn-rematch').textContent = '✅ قبول الإعادة';
  document.getElementById('btn-rematch').onclick = () => {
    socket.emit('rematch_accept', { roomId });
    hideModal('result-modal');
  };

  const declineBtn = document.createElement('button');
  declineBtn.className = 'btn btn-ghost';
  declineBtn.textContent = '❌ رفض';
  declineBtn.onclick = () => {
    socket.emit('rematch_decline', { roomId });
    hideModal('result-modal');
    showScreen('lobby');
  };
  document.querySelector('.result-buttons').appendChild(declineBtn);
});

socket.on('rematch_start', ({ white, black }) => {
  myColor = (socket.id === white) ? 'white' : 'black';
  gameOver = false;
  hideModal('result-modal');
  initGame(null);
  toast('⚔️ مباراة جديدة! الألوان تبدلت', 'success');
});

socket.on('rematch_declined', () => {
  document.getElementById('rematch-status').textContent = '😔 منافسك رفض الإعادة';
});

// ═══════════════════════════════════════════════════════════════════════════════
// INIT GAME
// ═══════════════════════════════════════════════════════════════════════════════
function initGame(fen) {
  chess = new Chess();
  if (fen) chess.load(fen);

  gameOver   = false;
  lastMove   = null;
  selectedSquare = null;
  legalMoves = [];

  // Player info
  const myBadge  = document.getElementById('my-badge');
  const oppBadge = document.getElementById('opponent-badge');
  myBadge.textContent  = myColor === 'white' ? 'أبيض ♔' : 'أسود ♚';
  oppBadge.textContent = myColor === 'white' ? 'أسود ♚' : 'أبيض ♔';
  myBadge.className    = `player-color-badge ${myColor}`;
  oppBadge.className   = `player-color-badge ${myColor === 'white' ? 'black' : 'white'}`;

  document.getElementById('my-avatar').textContent       = myColor === 'white' ? '♔' : '♚';
  document.getElementById('opponent-avatar').textContent = myColor === 'white' ? '♚' : '♔';

  buildBoard();
  buildQuickChat();
  updateStatusBar();
  updateCaptured();
  showScreen('game');
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI BUTTON BINDINGS
// ═══════════════════════════════════════════════════════════════════════════════
document.getElementById('btn-create').addEventListener('click', () => {
  socket.emit('create_room');
});

document.getElementById('btn-join').addEventListener('click', () => {
  const val = document.getElementById('room-input').value.trim().toUpperCase();
  if (!val) return;
  socket.emit('join_room', { roomId: val });
});

document.getElementById('room-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});

document.getElementById('btn-copy-code').addEventListener('click', () => {
  const code = document.getElementById('display-room-id').textContent;
  navigator.clipboard.writeText(code).then(() => toast('✅ تم نسخ الرمز!', 'success'));
});

document.getElementById('btn-copy-link').addEventListener('click', () => {
  const link = document.getElementById('room-link').value;
  navigator.clipboard.writeText(link).then(() => toast('✅ تم نسخ الرابط!', 'success'));
});

document.getElementById('btn-resign').addEventListener('click', () => {
  if (gameOver) return;
  if (!confirm('هل تريد الاستسلام؟')) return;
  socket.emit('resign', { roomId, color: myColor });
  gameOver = true;
  showResult('🏳', 'استسلمت!', 'أنهيت المباراة بالاستسلام.');
});

document.getElementById('btn-rematch').addEventListener('click', () => {
  socket.emit('rematch_request', { roomId });
  document.getElementById('rematch-status').textContent = '⏳ في انتظار رد منافسك...';
  document.getElementById('btn-rematch').disabled = true;
});

document.getElementById('btn-lobby').addEventListener('click', () => {
  hideModal('result-modal');
  location.reload();
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-JOIN FROM URL QUERY PARAM
// ═══════════════════════════════════════════════════════════════════════════════
window.addEventListener('load', () => {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  if (room) {
    document.getElementById('room-input').value = room.toUpperCase();
    // Small delay to let socket connect
    setTimeout(() => socket.emit('join_room', { roomId: room }), 400);
  }
});