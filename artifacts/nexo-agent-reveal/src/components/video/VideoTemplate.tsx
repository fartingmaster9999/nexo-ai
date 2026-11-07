import { useEffect } from 'react';
import {
  VideoCanvas,
  VideoPausedContext,
  type VideoAspectRatio,
  useVideoPlayer,
} from '@/lib/video';
import { AnimatePresence } from 'framer-motion';
import { Scene1 } from './video_scenes/Scene1';
import { Scene3 } from './video_scenes/Scene3';

export const SCENE_DURATIONS = {
  tease: 1800,
  reveal: 4200,
};

export const VIDEO_ASPECT_RATIO: VideoAspectRatio = '16:9';

const SCENE_COMPONENTS = [Scene1, Scene3];
const SCENE_KEYS = Object.keys(SCENE_DURATIONS);

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  paused = false,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  paused?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentScene, currentSceneKey } = useVideoPlayer({
    durations,
    loop,
    paused,
  });
  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const baseSceneIndex = SCENE_KEYS.indexOf(baseSceneKey);
  const SceneComponent = SCENE_COMPONENTS[baseSceneIndex];

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  return (
    <VideoPausedContext.Provider value={paused}>
      <VideoCanvas
        aspectRatio={VIDEO_ASPECT_RATIO}
        className="nexo-grain"
        style={{ backgroundColor: 'var(--nexo-ink)' }}
      >
        <div className="absolute inset-0 overflow-hidden">
          <AnimatePresence mode="sync">
            {SceneComponent && (
              <SceneComponent key={currentSceneKey} sceneIndex={currentScene} />
            )}
          </AnimatePresence>
        </div>
      </VideoCanvas>
    </VideoPausedContext.Provider>
  );
}
