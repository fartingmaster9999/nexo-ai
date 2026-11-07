import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene4({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  useSceneTimer([]);
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#030812]"
      initial={{ opacity: 0, scale: 1.09 }}
      animate={{ opacity: 1, scale: [1.04, 1, 1, 1.015] }}
      exit={{ opacity: 0, scale: 1.08 }}
      transition={{ duration: 7.95, times: [0, 0.18, 0.72, 1], ease: EASE }}
    >
      <motion.img
        src={`${import.meta.env.BASE_URL}images/nexo-agent-splash.png`}
        alt="NexoAI — Agent Mode"
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ opacity: 0.72, scale: 1.04 }}
        animate={{ opacity: 1, scale: [1.04, 1, 1, 1.012] }}
        transition={{ duration: 7.9, times: [0, 0.17, 0.74, 1], ease: EASE }}
        draggable={false}
      />
      <motion.div
        className="absolute left-1/2 top-1/2 aspect-square w-[20vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#56a4ff]/60"
        initial={{ scale: 0.25, opacity: 0 }}
        animate={{ scale: [0.25, 0.42, 0.42, 2.6], opacity: [0, 0.22, 0.18, 0.02] }}
        transition={{ duration: 7.9, times: [0, 0.13, 0.78, 1], ease: EASE }}
      />
    </motion.section>
  );
}
