import React, { useEffect, useRef } from 'react';
import { Camera } from '../types';

export interface DemoSubject { name: string; imageUrl: string | null; confidence: number; }

/** An entirely local, synthetic scene. No video capture or recognition runs here. */
export function DemoCameraScene({ camera, hasDetection = false, subject }: {
  camera: Camera; hasDetection?: boolean; subject?: DemoSubject;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let frame = 0; let animation = 0; let lastTime = -Infinity;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const variation = Number(camera.id.slice(-1)) || 1;
    const outdoor = variation % 2 === 0;
    const people = [
      { x: 75, y: 224, speed: .48, skin: '#865b40', clothing: '#365b65' },
      { x: 340, y: 244, speed: -.38, skin: '#543528', clothing: '#5e6652' },
      { x: 540, y: 212, speed: -.28, skin: '#a17652', clothing: '#48556e' },
      { x: 220, y: 272, speed: .34, skin: '#69452f', clothing: '#736452' }
    ];
    const draw = (time: number) => {
      if (!reducedMotion) animation = requestAnimationFrame(draw);
      if (time - lastTime < 1000 / 12) return;
      lastTime = time; frame++;
      const background = ctx.createLinearGradient(0, 0, 0, 360);
      background.addColorStop(0, outdoor ? '#415e64' : '#2b3f4b');
      background.addColorStop(1, '#101e29');
      ctx.fillStyle = background; ctx.fillRect(0, 0, 640, 360);
      // Architectural scene varies by camera: a plaza / forecourt or concourse.
      ctx.fillStyle = outdoor ? '#31494c' : '#30404a'; ctx.fillRect(0, 30, 640, 140);
      ctx.fillStyle = '#152730';
      for (let x = -20; x < 640; x += 96) {
        ctx.fillRect(x + variation * 4, 48, 64, 89);
        ctx.fillStyle = '#53717a'; ctx.fillRect(x + 8 + variation * 4, 56, 2, 73); ctx.fillStyle = '#152730';
      }
      ctx.fillStyle = '#53605b'; ctx.fillRect(0, 149, 640, 9);
      const floor = ctx.createLinearGradient(0, 156, 0, 360);
      floor.addColorStop(0, '#43545a'); floor.addColorStop(1, '#162b36');
      ctx.fillStyle = floor; ctx.fillRect(0, 158, 640, 202);
      ctx.strokeStyle = '#9fb5ba25'; ctx.lineWidth = 1;
      for (let x = -400; x < 1100; x += 100) { ctx.beginPath(); ctx.moveTo(320 + (x - 320) * .2, 158); ctx.lineTo(x, 360); ctx.stroke(); }
      for (const y of [174, 200, 238, 294]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(640, y); ctx.stroke(); }
      if (outdoor) {
        for (const x of [36, 555]) {
          ctx.fillStyle = '#14262b'; ctx.fillRect(x + 16, 85, 9, 80);
          ctx.fillStyle = '#2b5149'; ctx.beginPath(); ctx.ellipse(x + 20, 80, 33, 42, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#748287'; ctx.fillRect(409, 177, 118, 27); ctx.fillStyle = '#111e26';
        ctx.fillRect(423, 197, 13, 13); ctx.fillRect(500, 197, 13, 13);
      } else {
        ctx.fillStyle = '#192e38'; ctx.fillRect(99, 24, 16, 166); ctx.fillRect(510, 24, 16, 166);
        ctx.fillStyle = '#83c4c54d'; ctx.fillRect(149, 18, 342, 3);
      }
      people.forEach((person, index) => {
        const x = ((person.x + frame * person.speed + variation * 16) % 740 + 740) % 740 - 50;
        const y = person.y + Math.sin(frame * .12 + index) * 1.1;
        const scale = .8 + (y - 200) / 170;
        ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
        ctx.fillStyle = '#020c143d'; ctx.beginPath(); ctx.ellipse(8, 16, 20, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#142532'; ctx.lineWidth = 8;
        for (const direction of [-1, 1]) { ctx.beginPath(); ctx.moveTo(direction * 6, -3); ctx.lineTo(direction * 7 + Math.sin(frame * .15) * direction * 5, 17); ctx.stroke(); }
        ctx.fillStyle = person.clothing; ctx.fillRect(-12, -42, 24, 40);
        ctx.fillStyle = person.skin; ctx.beginPath(); ctx.ellipse(0, -55, 9, 12, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#191c21'; ctx.beginPath(); ctx.ellipse(0, -62, 9, 5, 0, Math.PI, Math.PI * 2); ctx.fill();
        const hit = index === 1 && hasDetection;
        ctx.strokeStyle = hit ? '#ff8074' : '#76c8c799'; ctx.lineWidth = hit ? 2 : 1;
        ctx.strokeRect(-20, -74, 40, 97);
        ctx.font = '9px monospace'; ctx.fillStyle = hit ? '#ffb2a4' : '#9ecac9';
        ctx.fillText(hit ? 'DEMO MATCH' : `TRACK 0${index + 1}`, -20, -81);
        if (hit && subject) { ctx.fillStyle = '#311e20e6'; ctx.fillRect(-23, 27, 70, 17); ctx.fillStyle = '#ffc2b8'; ctx.fillText(`${(subject.confidence * 100).toFixed(1)}% SIM`, -18, 39); }
        ctx.restore();
      });
      // Restrained sensor texture and a travelling scan line.
      ctx.fillStyle = '#06121d1c'; for (let y = 0; y < 360; y += 4) ctx.fillRect(0, y, 640, 1);
      ctx.fillStyle = '#90e4db0b'; ctx.fillRect(0, frame % 360, 640, 3);
      const shade = ctx.createRadialGradient(320, 180, 80, 320, 180, 390);
      shade.addColorStop(0, '#00000000'); shade.addColorStop(1, '#03101d99');
      ctx.fillStyle = shade; ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = '#a3c7cd'; ctx.font = '9px monospace';
      ctx.fillText('SYNTHETIC TRAINING SCENE', 12, 344);
    };
    animation = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animation);
  }, [camera.id, hasDetection, subject?.confidence]);

  return <div className="demo-scene">
    <canvas ref={canvasRef} className="demo-camera-canvas" width={640} height={360} aria-label={`Synthetic scene for ${camera.name}`}/>
    <div className="demo-scene-label">SYNTHETIC SCENE / 12 FPS</div>
    {hasDetection && subject && <div className="demo-subject-chip">
      {subject.imageUrl && <img src={subject.imageUrl} alt="Fictional demo subject"/>}
      <div><strong>{subject.name}</strong><span>{(subject.confidence * 100).toFixed(1)}% · SIMULATED</span></div>
    </div>}
  </div>;
}
