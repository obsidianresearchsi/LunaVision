import React, { FormEvent, useState } from 'react';

type Message = { prompt: string; reply: string };
type CameraContext = { name: string; location: string; playback: string };

function previewReply(prompt: string, camera: CameraContext) {
  if (/\b(status|online|offline|playing|buffering|connection)\b/i.test(prompt)) return camera.playback;
  if (/\b(where|location|address)\b/i.test(prompt)) return camera.location || 'No location is recorded for this camera.';
  if (/\b(which|name|camera details)\b/i.test(prompt)) return 'You are chatting with ' + camera.name + '.';
  return 'This preview can report the selected camera name, recorded location, and browser playback status. Footage questions require the AI integration.';
}

export default function CameraChat({ camera }: { camera: CameraContext }) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt) return;
    setMessages(previous => [...previous, { prompt, reply: previewReply(prompt, camera) }]);
    setInput('');
  }

  return <section className="lv-camera-chat" aria-label="Camera chat">
    <h3>Chat with {camera.name}</h3>
    <p>Preview · Ask for the camera location or playback status.</p>
    <div role="log" aria-label="Camera conversation">
      {messages.map(({ prompt, reply }, index) => <div key={index}>
        <p><strong>You</strong> {prompt}</p>
        <p><strong>Camera assistant</strong> {reply}</p>
      </div>)}
    </div>
    <form onSubmit={send}>
      <label>Message<input value={input} onChange={event => setInput(event.target.value)} maxLength={400} required /></label>
      <button type="submit" disabled={!input.trim()}>Send message</button>
    </form>
  </section>;
}
