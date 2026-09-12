import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, orderBy, onSnapshot, setDoc, addDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { conversationId } from "../../lib/utils";
import { useApp } from "../../context/AppContext";
import Avatar from "../ui/Avatar";

export default function ChatView({ otherUid, otherName }) {
  const { user, myRecipes, addToast } = useApp();
  const navigate = useNavigate();
  const cid = conversationId(user.uid, otherUid);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db, 'conversations', cid, 'messages'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snap => setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, [cid]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const send = async (recipeShare = null) => {
    if (!recipeShare && !text.trim()) return;
    const payload = { senderId: user.uid, text: recipeShare ? '' : text.trim(), recipeShare, createdAt: serverTimestamp() };
    try {
      await setDoc(doc(db, 'conversations', cid), {
        participants: [user.uid, otherUid],
        participantNames: { [user.uid]: user.displayName, [otherUid]: otherName },
        updatedAt: serverTimestamp(),
        lastMessage: { senderId: user.uid, text: payload.text, recipeShare },
      }, { merge: true });
      await addDoc(collection(db, 'conversations', cid, 'messages'), payload);
      setText('');
      setShowPicker(false);
    } catch { addToast("Échec de l'envoi du message", 'error'); }
  };

  return (
    <div className="chat-layout">
      <div className="chat-head">
        <Avatar name={otherName} size={36} />
        <div className="chat-head__title">{otherName}</div>
        <button className="icon-btn icon-btn--ghost" onClick={() => navigate('/messages')} aria-label="Retour">←</button>
      </div>

      <div className="chat-messages">
        {messages.map(m => (
          <div key={m.id} className={`chat-row ${m.senderId === user.uid ? 'me' : ''}`}>
            {m.recipeShare ? (
              <button className="bubble bubble--recipe" onClick={() => navigate(`/recette/${m.recipeShare.id}`)}>
                <span style={{ fontSize: 'var(--step-2)' }}>{m.recipeShare.emoji || '🍽️'}</span>
                <strong>{m.recipeShare.name}</strong>
              </button>
            ) : (
              <div className="bubble">{m.text}</div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {showPicker && (
        <div className="chat-recipe-picker">
          <div className="field__label">Partager une recette</div>
          {myRecipes.map(r => (
            <button key={r.id} className="pick-item" style={{ width: '100%', textAlign: 'left' }}
              onClick={() => send({ id: r.id, name: r.name, emoji: r.emoji, photoURL: r.photoURL || null })}>
              {r.emoji || '🍽️'} {r.name}
            </button>
          ))}
          {myRecipes.length === 0 && <p style={{ color: 'var(--ink-3)', fontSize: 'var(--step--1)' }}>Aucune recette à partager.</p>}
        </div>
      )}

      <div className="chat-input">
        <button className="icon-btn icon-btn--ghost" onClick={() => setShowPicker(p => !p)} title="Partager une recette">📎</button>
        <input className="input" style={{ flex: 1 }} value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Votre message…" />
        <button className="btn btn--primary" style={{ padding: '11px 16px' }} onClick={() => send()} aria-label="Envoyer">➤</button>
      </div>
    </div>
  );
}