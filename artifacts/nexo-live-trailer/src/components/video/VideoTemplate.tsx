import { AnimatePresence } from 'framer-motion';

import {
  VideoCanvas,
  type VideoAspectRatio,
  useVideoPlayer,
} from '@/lib/video';

import { Scene1 } from './Scene1';
import { Scene2 } from './Scene2';

export const SCENE_DURATIONS = {
  tease: 1800,
  reveal: 4200,
};

export const VIDEO_ASPECT_RATIO: VideoAspectRatio = '16:9';

const SCENE_COMPONENTS = [Scene1, Scene2];

export default function VideoTemplate() {
  const { currentScene, currentSceneKey } = useVideoPlayer({
    durations: SCENE_DURATIONS,
  });
  const SceneComponent = SCENE_COMPONENTS[currentScene];

  return (
    <VideoCanvas
      aspectRatio={VIDEO_ASPECT_RATIO}
      className="nexo-grain"
      style={{ backgroundColor: 'var(--nexo-ink)' }}
    >
      <div className="absolute inset-0 overflow-hidden">
        <AnimatePresence mode="sync">
          {SceneComponent && (
            <SceneComponent key={currentSceneKey} />
          )}
        </AnimatePresence>
      </div>
    </VideoCanvas>
  );
}
