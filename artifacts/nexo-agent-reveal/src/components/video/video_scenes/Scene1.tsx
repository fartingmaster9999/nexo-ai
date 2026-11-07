import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

const EASE = [0.2, 0.85, 0.25, 1] as const;

export function Scene1({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  const [stage, setStage] = useState(0);
  useSceneTimer([
    { time: 200, callback: () => setStage(1) },
    { time: 650, callback: () => setStage(2) },
    { time: 1200, callback: () => setStage(3) },
    { time: 1800, callback: () => setStage(4) },
    { time: 2000, callback: () => setStage(5) },
  ]);

  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 0, scale: 1.03 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.12 }}
      transition={{ duration: 0.22, ease: EASE }}
    >
      <motion.div
        className="absolute left-1/2 top-1/2 aspect-square w-[30vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#428eff]/50"
        initial={{ scale: 0.8, opacity: 0.16, rotate: -12 }}
        animate={{
          scale: stage >= 3 ? [0.8, 1.04, 0.95] : stage >= 2 ? [0.82, 1.02] : 0.82,
          opacity: stage >= 3 ? [0.22, 0.7, 0.32] : stage >= 1 ? [0.24, 0.48] : 0.16,
          rotate: stage >= 3 ? [-12, 0, 8] : -12,
        }}
        transition={{ duration: 0.38, ease: EASE }}
        style={{ boxShadow: '0 0 2vmin rgba(36,125,255,.4), inset 0 0 2vmin rgba(34,102,255,.12)' }}
      />
      <motion.div
        className="absolute left-1/2 top-1/2 h-[0.2vmin] w-[1.3vmin] -translate-x-1/2 -translate-y-1/2"
        initial={{ scaleX: 0.5, opacity: 0.55 }}
        animate={{
          scaleX: stage >= 4 ? [0.7, 5, 0.8, 1] : stage >= 2 ? [0.7, 2.8] : 0.5,
          opacity: stage >= 4 ? [0.45, 1, 0.7, 1] : stage >= 1 ? [0.55, 0.92] : 0.55,
        }}
        transition={{ duration: 0.42, ease: EASE }}
        style={{ background: '#8cc5ff', boxShadow: '0 0 2vmin rgba(61,139,255,.9)' }}
      />
      <motion.div
        className="absolute left-1/2 top-[43%] h-[7vmin] w-[0.18vmin] -translate-x-1/2 origin-center"
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{ scaleY: stage >= 2 ? [0, 1, 0] : 0, opacity: stage >= 2 ? [0, 0.9, 0] : 0 }}
        transition={{ duration: 0.36, ease: EASE }}
        style={{ background: '#58a5ff', boxShadow: '0 0 1.5vmin rgba(42,129,255,.8)' }}
      />
      <motion.div
        className="absolute left-0 top-0 z-20 h-full w-1/2 bg-[#020711]"
        initial={{ x: '-100%' }}
        animate={{ x: stage >= 5 ? '0%' : '-100%' }}
        transition={{ duration: 0.42, ease: EASE }}
      />
      <motion.div
        className="absolute right-0 top-0 z-20 h-full w-1/2 bg-[#020711]"
        initial={{ x: '100%' }}
        animate={{ x: stage >= 5 ? '0%' : '100%' }}
        transition={{ duration: 0.42, ease: EASE }}
      />
      <motion.div
        className="absolute left-1/2 top-0 z-30 h-full w-[0.22vmin] -translate-x-1/2"
        initial={{ opacity: 0.5, scaleY: 0.2 }}
        animate={{ opacity: stage >= 5 ? 1 : [0.5, 0.25, 0.7], scaleY: stage >= 5 ? 1 : [0.2, 0.65, 0.3] }}
        transition={{ duration: 0.28 }}
        style={{ background: '#83c2ff', boxShadow: '0 0 2vmin #1769ff' }}
      />
    </motion.section>
  );
}
