export type PresenceObject={class:string;score:number;bbox:[number,number,number,number]};
type Detector=(frame:HTMLCanvasElement)=>Promise<PresenceObject[]>;
let detector:Promise<Detector>|undefined;
export function getPresenceDetector():Promise<Detector>{
  detector??=(async()=>{
    const tf=await import('@tensorflow/tfjs');await tf.ready();
    const {load}=await import('@tensorflow-models/coco-ssd');
    const options={base:'lite_mobilenet_v2',modelUrl:'/models/coco-ssd-lite/model.json'} as const;
    let model;try{model=await load(options);}catch(error){if(tf.getBackend()==='cpu')throw error;await tf.setBackend('cpu');model=await load(options);}
    return (frame:HTMLCanvasElement)=>model.detect(frame,30,0.5);
  })().catch(error=>{detector=undefined;throw error;});
  return detector;
}
export function presenceCounts(objects:PresenceObject[],minimumScore:number){
  const selected=objects.filter(object=>object.score>=minimumScore);
  const people=selected.filter(object=>object.class==='person');
  const vehicles=selected.filter(object=>['car','truck','bus','motorcycle','bicycle'].includes(object.class));
  const relevant=[...people,...vehicles];
  return {people:people.length,vehicles:vehicles.length,confidence:relevant.length?Math.min(...relevant.map(object=>object.score)):0};
}
