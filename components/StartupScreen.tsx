/**
 * StartupScreen Component
 * 
 * Animated splash screen with logo, loading bar, and startup sound.
 * Shows for 5 seconds before transitioning to the login screen.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Shield } from 'lucide-react';

interface StartupScreenProps {
  onComplete: () => void;
  duration?: number; // Duration in milliseconds
}

export const StartupScreen: React.FC<StartupScreenProps> = ({ 
  onComplete, 
  duration = 5000 
}) => {
  const [progress, setProgress] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const [statusText, setStatusText] = useState('Initializing system...');
  const [logoLoaded, setLogoLoaded] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Play startup sound
  useEffect(() => {
    const playStartupSound = () => {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        
        audioContextRef.current = new AudioContextClass();
        const ctx = audioContextRef.current;
        
        // Create a tech startup sound sequence
        const now = ctx.currentTime;
        
        // First tone - low hum
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(120, now);
        osc1.frequency.exponentialRampToValueAtTime(180, now + 0.3);
        gain1.gain.setValueAtTime(0, now);
        gain1.gain.linearRampToValueAtTime(0.15, now + 0.1);
        gain1.gain.linearRampToValueAtTime(0.08, now + 0.5);
        gain1.gain.linearRampToValueAtTime(0, now + 1);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 1);

        // Second tone - rising sweep
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(200, now + 0.2);
        osc2.frequency.exponentialRampToValueAtTime(600, now + 0.8);
        gain2.gain.setValueAtTime(0, now + 0.2);
        gain2.gain.linearRampToValueAtTime(0.12, now + 0.4);
        gain2.gain.linearRampToValueAtTime(0, now + 1);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.2);
        osc2.stop(now + 1);

        // Third tone - confirmation beep
        const osc3 = ctx.createOscillator();
        const gain3 = ctx.createGain();
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(880, now + 0.8);
        gain3.gain.setValueAtTime(0, now + 0.8);
        gain3.gain.linearRampToValueAtTime(0.1, now + 0.85);
        gain3.gain.linearRampToValueAtTime(0, now + 1.2);
        osc3.connect(gain3);
        gain3.connect(ctx.destination);
        osc3.start(now + 0.8);
        osc3.stop(now + 1.2);

      } catch (err) {
        console.warn('Could not play startup sound:', err);
      }
    };

    // Small delay to ensure component is mounted
    const soundTimeout = setTimeout(playStartupSound, 100);

    return () => {
      clearTimeout(soundTimeout);
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Progress bar animation
  useEffect(() => {
    const startTime = Date.now();
    const statusMessages = [
      { at: 0, text: 'Initializing system...' },
      { at: 15, text: 'Loading security modules...' },
      { at: 30, text: 'Connecting to database...' },
      { at: 50, text: 'Verifying encryption...' },
      { at: 70, text: 'Loading facial recognition engine...' },
      { at: 85, text: 'Starting Lunar Vision...' },
      { at: 95, text: 'Ready' }
    ];

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min((elapsed / duration) * 100, 100);
      setProgress(newProgress);

      // Update status text based on progress
      const currentStatus = [...statusMessages]
        .reverse()
        .find(s => newProgress >= s.at);
      if (currentStatus) {
        setStatusText(currentStatus.text);
      }

      if (newProgress >= 100) {
        clearInterval(interval);
        setFadeOut(true);
        setTimeout(onComplete, 500); // Wait for fade out animation
      }
    }, 30);

    return () => clearInterval(interval);
  }, [duration, onComplete]);

  return (
    <div 
      className={`eagle-startup fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-br from-eagle-950 via-eagle-900 to-eagle-950 transition-opacity duration-500 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Background grid pattern */}
      <div 
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: 'linear-gradient(#3b82f6 1px, transparent 1px), linear-gradient(90deg, #3b82f6 1px, transparent 1px)',
          backgroundSize: '50px 50px'
        }}
      />

      {/* Animated circles background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full border border-blue-500/10 animate-pulse" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full border border-blue-500/15 animate-ping" style={{ animationDuration: '3s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full border border-blue-500/20" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[250px] h-[250px] rounded-full border border-blue-500/30 animate-pulse" style={{ animationDuration: '2s' }} />
      </div>

      {/* Logo container */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Logo with animation - BIGGER SIZE */}
        <div className={`mb-8 transition-all duration-1000 ${progress > 0 ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}>
          <div className="relative animate-float">
            {/* Outer glow effect */}
            <div className="absolute inset-0 blur-3xl bg-blue-500/40 rounded-full scale-150" />
            {/* Inner glow */}
            <div className="absolute inset-0 blur-xl bg-cyan-400/30 rounded-full scale-125" />
            
            {/* Logo image - EXTRA LARGE */}
            <img 
              src="/logo/lunar-vision-white.png" 
              alt="Lunar Vision"
              className={`relative w-64 h-64 md:w-72 md:h-72 object-contain drop-shadow-2xl transition-all duration-1000 ${
                logoLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
              }`}
              onLoad={() => setLogoLoaded(true)}
              onError={(e) => {
                // Fallback to shield icon if logo fails to load
                e.currentTarget.style.display = 'none';
                const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                if (fallback) fallback.style.display = 'flex';
              }}
            />
            {/* Fallback icon - EXTRA LARGE */}
            <div className="hidden w-64 h-64 md:w-72 md:h-72 items-center justify-center bg-gradient-to-br from-blue-600 to-blue-800 rounded-3xl shadow-2xl">
              <Shield size={128} className="text-white drop-shadow-lg" />
            </div>
          </div>
        </div>

        {/* Title - BIGGER TEXT */}
        <h1 className={`text-5xl md:text-6xl font-bold text-white mb-3 tracking-wider transition-all duration-700 delay-300 ${
          progress > 10 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          LUNAR VISION
        </h1>
        <p className={`text-blue-400 text-2xl md:text-3xl tracking-[0.4em] mb-10 font-light transition-all duration-700 delay-500 ${
          progress > 20 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          INTELLIGENCE
        </p>

        {/* Tagline */}
        <p className={`text-slate-400 text-lg mb-8 transition-all duration-700 delay-600 ${
          progress > 25 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          Advanced Facial Recognition & Surveillance System
        </p>

        {/* Loading bar container - WIDER */}
        <div className={`w-96 md:w-[450px] transition-all duration-700 delay-700 ${
          progress > 30 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          {/* Progress bar background */}
          <div className="h-2 bg-eagle-800 rounded-full overflow-hidden mb-4 shadow-inner">
            {/* Progress bar fill */}
            <div 
              className="h-full bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-400 rounded-full transition-all duration-100 ease-out relative"
              style={{ width: `${progress}%` }}
            >
              {/* Shimmer effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
            </div>
          </div>

          {/* Status text - BIGGER */}
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400 font-mono">{statusText}</span>
            <span className="text-blue-400 font-mono font-bold">{Math.round(progress)}%</span>
          </div>
        </div>


      </div>

      {/* Version info */}
      <div className="absolute bottom-8 text-slate-500 text-sm font-mono">
        Secure Connection Established
      </div>

      {/* Custom animations */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 1.5s infinite;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        .animate-float {
          animation: float 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

export default StartupScreen;
