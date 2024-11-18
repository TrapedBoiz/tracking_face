// import * as THREE from 'three';
// import { OrbitControls } from "https://cdn.skypack.dev/three@0.150.1/examples/jsm/controls/OrbitControls";
// import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// import { VRMLoaderPlugin, VRMUtils, VRM } from '@pixiv/three-vrm';

// class BasicScene {
//     scene;
//     camera;
//     renderer;
//     controls;

//     constructor() {
//         this.scene = new THREE.Scene();
//         this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 5000);
//         this.camera.position.set(0, 1.5, 3); // Adjust camera position for better view

//         this.renderer = new THREE.WebGLRenderer({ antialias: true });
//         this.renderer.setSize(window.innerWidth, window.innerHeight);
//         this.renderer.outputEncoding = THREE.sRGBEncoding;
//         document.body.appendChild(this.renderer.domElement);

//         // Lighting
//         const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
//         this.scene.add(ambientLight);

//         const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
//         directionalLight.position.set(0, 1, 1).normalize();
//         this.scene.add(directionalLight);

//         // Orbit Controls
//         this.controls = new OrbitControls(this.camera, this.renderer.domElement);
//         this.controls.target.set(0, 1.5, 0);
//         this.controls.update();

//         // Render loop
//         this.animate();
//         window.addEventListener('resize', this.onWindowResize.bind(this), false);
//     }

//     onWindowResize() {
//         this.camera.aspect = window.innerWidth / window.innerHeight;
//         this.camera.updateProjectionMatrix();
//         this.renderer.setSize(window.innerWidth, window.innerHeight);
//     }

//     animate = () => {
//         requestAnimationFrame(this.animate);
//         this.renderer.render(this.scene, this.camera);
//     };
// }

// class Avatar {
//     loader = new GLTFLoader();
//     vrm;

//     constructor(url, scene) {
//         this.loadModel(url, scene);
//     }

//     loadModel(url, scene) {
//         this.loader.register(parser => new VRMLoaderPlugin(parser));
//         this.loader.load(
//             url,
//             (gltf) => {
//                 const vrm = gltf.userData.vrm;
//                 VRMUtils.removeUnnecessaryVertices(gltf.scene);
//                 VRMUtils.removeUnnecessaryJoints(gltf.scene);
//                 vrm.scene.position.set(0, 0, 0);
//                 vrm.scene.rotation.set(0, Math.PI, 0); // Rotate to face camera
//                 scene.add(vrm.scene);
//                 this.vrm = vrm;
//             },
//             (progress) => console.log(`Loading model... ${((progress.loaded / progress.total) * 100).toFixed(2)}%`),
//             (error) => console.error('Error loading VRM model:', error)
//         );
//     }
// }

// // Initialize scene and load VRM model
// const scene = new BasicScene();
// const avatar = new Avatar('./Ayame_Shiratori_normal.vrm', scene.scene);


import * as THREE from 'three';
import * as Kalidokit from 'https://cdn.jsdelivr.net/npm/kalidokit@1.1/dist/kalidokit.es.js';
import { OrbitControls } from "https://cdn.skypack.dev/three@0.150.1/examples/jsm/controls/OrbitControls"; //control mouse
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRM, VRMExpression, VRMExpressionMorphTargetBind, VRMExpressionPresetName } from '@pixiv/three-vrm';
import { FilesetResolver, HolisticLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const clamp = Kalidokit.Utils.clamp;
const lerp = Kalidokit.Vector.lerp;
function getViewportSizeAtDepth(
    camera,
    depth
) {
    const viewportHeightAtDepth =
        2 * depth * Math.tan(THREE.MathUtils.degToRad(0.5 * camera.fov));
    const viewportWidthAtDepth = viewportHeightAtDepth * camera.aspect;
    return new THREE.Vector2(viewportWidthAtDepth, viewportHeightAtDepth);
}
function createCameraPlaneMesh(
    camera,
    depth,
    material
) {
    if (camera.near > depth || depth > camera.far) {
        console.warn("Camera plane geometry will be clipped by the `camera`!");
    }
    const viewportSize = getViewportSizeAtDepth(camera, depth);
    const cameraPlaneGeometry = new THREE.PlaneGeometry(
        viewportSize.width,
        viewportSize.height
    );
    cameraPlaneGeometry.translate(0, 0, -depth);
    return new THREE.Mesh(cameraPlaneGeometry, material);
}
class BasicScene {
    scene;
    width;
    height;
    camera;
    renderer;
    controls;
    lastTime;
    callbacks = [];
    constructor() {
        this.height = window.innerHeight;
        this.width = (this.height * 1280) / 720;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            60,
            this.width / this.height,
            0.01,
            5000
        );
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.width, this.height);
        THREE.ColorManagement.legacy = false;
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        document.body.appendChild(this.renderer.domElement);
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight.position.set(0, 1, 0);
        this.scene.add(directionalLight);
        this.camera.position.z = 0;
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        let orbitTarget = this.camera.position.clone();
        orbitTarget.z -= 5;
        this.controls.target = orbitTarget;
        this.controls.update();
        const video = document.getElementById("video");
        const inputFrameTexture = new THREE.VideoTexture(video);
        if (!inputFrameTexture) {
            throw new Error("Failed to get the 'input_frame' texture!");
        }
        inputFrameTexture.encoding = THREE.sRGBEncoding;
        const inputFramesDepth = 500;
        const inputFramesPlane = createCameraPlaneMesh(
            this.camera,
            inputFramesDepth,
            new THREE.MeshBasicMaterial({ map: inputFrameTexture })
        );
        this.scene.add(inputFramesPlane);
        this.render();
        window.addEventListener("resize", this.resize.bind(this));
    }
    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.width, this.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.render(this.scene, this.camera);
    }
    render(time = this.lastTime) {
        const delta = (time - this.lastTime) / 1000;
        this.lastTime = time;
        for (const callback of this.callbacks) {
            callback(delta);
        }
        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame((t) => this.render(t));
    }
}
class Avatar {
    scene;
    loader = new GLTFLoader();
    gltf;
    root;
    lastTime;
    riggedPose;
    oldLookTarget = new THREE.Euler();
    morphTargetMeshes = [];
    url;
    constructor(url, scene) {
        this.url = url;
        this.scene = scene;
        this.loadModel(this.url);
    }
    rigFace = (riggedFace) => {
        this.rigRotation('neck', riggedFace.head, 0.7);
        const Blendshape = this.gltf.expressionManager;
        const PresetName = VRMExpressionPresetName;
        riggedFace.eye.l = lerp(
            clamp(1 - riggedFace.eye.l, 0, 1),
            Blendshape.getValue(PresetName.BlinkLeft),
            0.5,
        );
        riggedFace.eye.r = lerp(
            clamp(1 - riggedFace.eye.r, 0, 1),
            Blendshape.getValue(PresetName.BlinkRight),
            0.5,
        );
        Blendshape.setValue(PresetName.BlinkLeft, riggedFace.eye.l * 1.3);
        Blendshape.setValue(PresetName.BlinkRight, riggedFace.eye.r * 1.3);
        Blendshape.setValue(
            PresetName.Ih,
            lerp(riggedFace.mouth.shape.I, Blendshape.getValue(PresetName.Ih), 0.5),
        );
        Blendshape.setValue(
            PresetName.Aa,
            lerp(riggedFace.mouth.shape.A, Blendshape.getValue(PresetName.Aa), 0.5),
        );
        Blendshape.setValue(
            PresetName.Ee,
            lerp(riggedFace.mouth.shape.E, Blendshape.getValue(PresetName.Ee), 0.5),
        );
        Blendshape.setValue(
            PresetName.Oh,
            lerp(riggedFace.mouth.shape.O, Blendshape.getValue(PresetName.Oh), 0.5),
        );
        Blendshape.setValue(
            PresetName.Ou,
            lerp(riggedFace.mouth.shape.U, Blendshape.getValue(PresetName.Ou), 0.5),
        );
        let lookTarget = new THREE.Euler(
            lerp(this.oldLookTarget.x, riggedFace.pupil.y, 0.4),
            lerp(this.oldLookTarget.y, riggedFace.pupil.x, 0.4),
            0,
            'XYZ',
        );
        this.oldLookTarget.copy(lookTarget);
        this.gltf.lookAt?.applier.lookAt(lookTarget);
    };
    rigPosition = (
        name,
        position = { x: 0, y: 0, z: 0 },
        dampener = 1,
        lerpAmount = 0.3,
    ) => {
        const Part = this.gltf.humanoid.getRawBoneNode(name);
        if (!Part) {
            return;
        }
        let vector = new THREE.Vector3(
            position.x * dampener,
            position.y * dampener,
            position.z * dampener,
        );
        Part.position.lerp(vector, lerpAmount); // interpolate
    };
    rigRotation = (
        name,
        rotation = { x: 0, y: 0, z: 0 },
        dampener = 1,
        lerpAmount = 0.3,
    ) => {
        if (name == 'leftUpperArm') {
            const Part = this.gltf.humanoid.getRawBoneNode(name);
            if (!Part) {
                return;
            }
            let euler = new THREE.Euler(
                rotation.x * dampener,
                rotation.y * dampener,
                rotation.z * dampener,
            );
            let quaternion = new THREE.Quaternion().setFromEuler(euler);
            Part.quaternion.slerp(quaternion, lerpAmount);
            return;
        }
        const Part = this.gltf.humanoid.getRawBoneNode(name);
        if (!Part) {
            return;
        }
        let euler = new THREE.Euler(
            rotation.x * dampener,
            rotation.y * dampener,
            rotation.z * dampener,
        );
        let quaternion = new THREE.Quaternion().setFromEuler(euler);
        Part.quaternion.slerp(quaternion, lerpAmount); // interpolate interpolate
    };
    loadModel(url) {
        this.url = url;
        this.loader.register((parser) => {
            return new VRMLoaderPlugin(parser);
        });
        this.loader.load(
            url,
            (gltf) => {
                const vrm = gltf.userData.vrm;
                VRMUtils.removeUnnecessaryVertices(gltf.scene);
                VRMUtils.removeUnnecessaryJoints(gltf.scene);
                vrm.scene.traverse((obj) => {
                    obj.frustumCulled = false;
                });
                this.morphTargetMeshes = [];
                // }
                this.gltf = vrm;
                this.gltf.scene.remove();
                vrm.scene.position.set(0, -1, -1);
                let degrees = 180;
                let radians = degrees * (Math.PI / 180);
                vrm.scene.rotation.set(0, radians, 0);
                this.scene.add(vrm.scene);
                this.updateExpression(vrm);
                console.log(this.gltf);
                this.render();
                this.init(vrm);
            },
            (progress) =>
                console.log(
                    "Loading model...",
                    100.0 * (progress.loaded / progress.total),
                    "%"
                ),
            (error) => console.error(error)
        );
    }
    render(time = this.lastTime) {
        const delta = (time - this.lastTime) / 1000;
        this.lastTime = time;
        if (this.gltf.mixer) {
            this.gltf.mixer.update(delta);
        }
        if (this.gltf && this.gltf.expressionManager) {
            this.gltf.expressionManager.update();
        }
        requestAnimationFrame((t) => this.render(t));
    }
    init(gltf) {
        gltf.scene.traverse((object) => {
            if (object.isBone && !this.root) {
                this.root = object;
            }
            if (!(object).isMesh) {
                return;
            }
            const mesh = object;
            mesh.frustumCulled = false;
            if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
                return;
            }
            console.log(mesh.morphTargetDictionary);
            this.morphTargetMeshes.push(mesh);
        });
        console.log('aaa', this.morphTargetMeshes);
    }
    updateExpression(vrmSet) {
        if (vrmSet.firstPerson.meshAnnotations && vrmSet.firstPerson.meshAnnotations.length > 0) {
            for (const meshAnnotation of vrmSet.firstPerson.meshAnnotations) {
                if (meshAnnotation.meshes && meshAnnotation.meshes[0].name.includes('Face')) {
                    var listSkinFaceMesh = meshAnnotation.meshes;
                    var vrmNewExpressionBrowLeftDown = new VRMExpression(`BrowLeftDown`);
                    vrmNewExpressionBrowLeftDown.addBind(new VRMExpressionMorphTargetBind({ index: 8, primitives: listSkinFaceMesh, weight: 1 }));
                    vrmSet.expressionManager.registerExpression(vrmNewExpressionBrowLeftDown);
                    break;
                }
            }

        }
    };
}
let holisticLandmarker;
let video;
const scene = new BasicScene();
const avatar = new Avatar(
    "./Ayame_Shiratori_normal.vrm",
    scene.scene
);
function onVideoFrame(time) {
    detectHolasticLandmarks(time);
    video.requestVideoFrameCallback(onVideoFrame);
}
function detectHolasticLandmarks(time) {
    if (!holisticLandmarker) {
        return;
    }
    const landmark = holisticLandmarker.detectForVideo(video, time);
    const faceLandmarks = landmark.faceLandmarks;
    if (faceLandmarks && faceLandmarks.length > 0) {
        var riggedFace = Kalidokit.Face.solve(faceLandmarks[0], {
            runtime: 'mediapipe',
            video: video
        });
        avatar.rigFace(riggedFace)
    }
}
async function streamWebcamThroughFaceLandmarker() {
    video = document.getElementById("video");
    function onAcquiredUserMedia(stream) {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
        };
    }
    try {
        const evt = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: "user",
                width: 1280,
                height: 720
            }
        });
        onAcquiredUserMedia(evt);
        video.requestVideoFrameCallback(onVideoFrame);
    } catch (e) {
        console.error(`Failed to acquire camera feed: ${e}`);
    }
}
async function runDemo() {
    await streamWebcamThroughFaceLandmarker();
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
    );
    holisticLandmarker = await HolisticLandmarker.createFromModelPath(vision,
        "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task"
    );
    await holisticLandmarker.setOptions({
        baseOptions: {
            delegate: "GPU"
        },
        runningMode: "VIDEO"
    });
    console.log("Finished Loading MediaPipe Model.");
}

runDemo();
