import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene4({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  const [closing, setClosing] = useState(false);
  useSceneTimer([{ time: 6700, callback: () => setClosing(true) }]);

  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 0, scale: 1.08 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.42, ease: EASE }}
    >
      <motion.img
        src={`${import.meta.env.BASE_URL}images/nexo-agent-splash.png`}
        alt="NexoAI — Agent Mode"
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ opacity: 0.72, scale: 1.04 }}
        animate={{ opacity: 1, scale: closing ? 1.08 : 1 }}
        transition={{ duration: closing ? 1.22 : 0.72, ease: EASE }}
        draggable={false}
      />
      <motion.div
        className="absolute left-0 top-0 z-20 h-full w-1/2 bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: closing ? '0%' : '-102%' }}
        transition={{ duration: closing ? 1.08 : 0.72, ease: EASE }}
      />
      <motion.div
        className="absolute right-0 top-0 z-20 h-full w-1/2 bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: closing ? '0%' : '102%' }}
        transition={{ duration: closing ? 1.08 : 0.72, ease: EASE }}
      />
      <motion.div
        className="absolute left-1/2 top-0 z-30 h-full w-[0.2vmin] -translate-x-1/2"
        initial={{ opacity: 0.8, scaleY: 0.8 }}
        animate={{ opacity: closing ? 1 : 0, scaleY: closing ? 1 : 0.8 }}
        transition={{ duration: 0.35 }}
        style={{ background: '#7bbcff', boxShadow: '0 0 2vmin #1769ff' }}
      />
    </motion.section>
  );
}
