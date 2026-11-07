import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

const EASE = [0.2, 0.85, 0.25, 1] as const;

export function Scene3({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  const [closing, setClosing] = useState(false);
  useSceneTimer([{ time: 5600, callback: () => setClosing(true) }]);

  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 0, scale: 1.06 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.28, ease: EASE }}
    >
      <motion.img
        src={`${import.meta.env.BASE_URL}images/nexo-agent-splash.png`}
        alt="NexoAI — Agent Mode"
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ opacity: 0.68, scale: 1.08 }}
        animate={{ opacity: 1, scale: closing ? 1.08 : 1 }}
        transition={{ duration: closing ? 1.35 : 0.66, ease: EASE }}
        draggable={false}
      />
      <motion.div
        className="absolute left-0 top-0 z-20 h-full w-[48%] bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: closing ? '0%' : '-104%' }}
        transition={{ duration: closing ? 1.35 : 0.62, ease: EASE }}
      />
      <motion.div
        className="absolute right-0 top-0 z-20 h-full w-[48%] bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: closing ? '0%' : '104%' }}
        transition={{ duration: closing ? 1.35 : 0.62, ease: EASE }}
      />
      <motion.div
        className="absolute left-1/2 top-0 z-30 h-full w-[0.22vmin] -translate-x-1/2"
        initial={{ opacity: 1, scaleY: 0.9 }}
        animate={{ opacity: closing ? 1 : 0, scaleY: closing ? 1 : 0.9 }}
        transition={{ duration: closing ? 1.35 : 0.24 }}
        style={{ background: '#8bc7ff', boxShadow: '0 0 2vmin #1769ff' }}
      />
    </motion.section>
  );
}
