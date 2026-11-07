import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene1({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  const [stage, setStage] = useState(0);
  useSceneTimer([
    { time: 350, callback: () => setStage(1) },
    { time: 900, callback: () => setStage(2) },
    { time: 1550, callback: () => setStage(3) },
    { time: 2650, callback: () => setStage(4) },
    { time: 3150, callback: () => setStage(5) },
  ]);

  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.08 }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      <motion.div
        className="absolute left-[50%] top-[48%] aspect-square w-[36vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#297eff]/40"
        initial={{ scale: 0.78, opacity: 0.14, rotate: -16 }}
        animate={{
          scale: stage >= 3 ? [0.78, 0.9, 1.12] : 0.82,
          opacity: stage >= 3 ? [0.14, 0.35, 0.66] : stage >= 1 ? 0.28 : 0.14,
          rotate: stage >= 3 ? [-16, -4, 7] : -16,
        }}
        transition={{ duration: 1.5, ease: EASE }}
      />
      <motion.div
        className="absolute left-1/2 top-[48%] h-[0.18vmin] w-[1vmin] -translate-x-1/2"
        initial={{ scaleX: 0.35, opacity: 0 }}
        animate={{
          scaleX: stage >= 4 ? [1, 5.5, 1] : stage >= 1 ? 1 : 0.35,
          opacity: stage >= 4 ? [0.8, 1, 0.35] : stage >= 1 ? 0.8 : 0,
        }}
        transition={{ duration: 0.65, ease: EASE }}
        style={{ background: '#72b6ff', boxShadow: '0 0 2.2vmin rgba(42,129,255,.9)' }}
      />
      <motion.div
        className="absolute left-1/2 top-[43%] h-[10vmin] w-[0.16vmin] -translate-x-1/2 origin-center"
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{
          scaleY: stage >= 2 ? 1 : 0,
          opacity: stage >= 2 ? [0.85, 0.35, 0] : 0,
        }}
        transition={{ duration: 0.62, ease: EASE }}
        style={{ background: '#5ea5ff', boxShadow: '0 0 1.5vmin rgba(42,129,255,.75)' }}
      />

      <motion.div
        className="absolute left-0 top-0 z-20 h-full w-1/2 bg-[#020711]"
        initial={{ x: '-100%' }}
        animate={{ x: stage >= 5 ? '0%' : '-100%' }}
        transition={{ duration: 0.72, ease: EASE }}
      />
      <motion.div
        className="absolute right-0 top-0 z-20 h-full w-1/2 bg-[#020711]"
        initial={{ x: '100%' }}
        animate={{ x: stage >= 5 ? '0%' : '100%' }}
        transition={{ duration: 0.72, ease: EASE }}
      />
      <motion.div
        className="absolute left-1/2 top-0 z-30 h-full w-[0.2vmin] -translate-x-1/2"
        initial={{ opacity: 0.22, scaleY: 0.4 }}
        animate={{ opacity: stage >= 5 ? 1 : 0.18, scaleY: stage >= 5 ? 1 : 0.4 }}
        transition={{ duration: 0.34 }}
        style={{ background: '#72b6ff', boxShadow: '0 0 2vmin #1769ff' }}
      />
    </motion.section>
  );
}
