/* Copyright 2023 The MediaPipe Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License. */

import * as THREE from 'three';
import * as Kalidokit from 'https://cdn.jsdelivr.net/npm/kalidokit@1.1/dist/kalidokit.es.js';
import { OrbitControls } from "https://cdn.skypack.dev/three@0.150.1/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRM, VRMExpression, VRMExpressionMorphTargetBind, VRMExpressionPresetName } from '@pixiv/three-vrm';
import {
    FilesetResolver,
    HolisticLandmarker,
    // FaceLandmarker,
    // PoseLandmarker,
    // HandLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";


const clamp = Kalidokit.Utils.clamp;
const remap = Kalidokit.Utils.remap;
const lerp = Kalidokit.Vector.lerp;
const calcArms = Kalidokit.calcArms;
const calcHips = Kalidokit.calcHips;
const calcLegs = Kalidokit.calcLegs;
/**
 * Returns the world-space dimensions of the viewport at `depth` units away from
 * the camera.
 */
function getViewportSizeAtDepth(
    camera,
    depth
) {
    const viewportHeightAtDepth =
        2 * depth * Math.tan(THREE.MathUtils.degToRad(0.5 * camera.fov));
    const viewportWidthAtDepth = viewportHeightAtDepth * camera.aspect;
    return new THREE.Vector2(viewportWidthAtDepth, viewportHeightAtDepth);
}

/**
 * Creates a `THREE.Mesh` which fully covers the `camera` viewport, is `depth`
 * units away from the camera and uses `material`.
 */
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
        // Initialize the canvas with the same aspect ratio as the video input
        this.height = window.innerHeight;
        this.width = (this.height * 1280) / 720;
        // Set up the Three.js scene, camera, and renderer
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

        // Set up the basic lighting for the scene
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight.position.set(0, 1, 0);
        this.scene.add(directionalLight);

        // Set up the camera position and controls
        this.camera.position.z = 0;
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        let orbitTarget = this.camera.position.clone();
        orbitTarget.z -= 5;
        this.controls.target = orbitTarget;
        this.controls.update();

        // Add a video background
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

        // Render the scene
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
        // Call all registered callbacks with deltaTime parameter
        for (const callback of this.callbacks) {
            callback(delta);
        }
        // Render the scene
        this.renderer.render(this.scene, this.camera);
        // Request next frame
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

        // Blendshapes and Preset Name Schema
        const Blendshape = this.gltf.expressionManager;
        const PresetName = VRMExpressionPresetName;
        // Simple example without winking. Interpolate based on old blendshape, then stabilize blink with `Kalidokit` helper function.
        // for VRM, 1 is closed, 0 is open.
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
        // riggedFace.eye = Kalidokit.Face.stabilizeBlink(riggedFace.eye, riggedFace.head.y);
        Blendshape.setValue(PresetName.BlinkLeft, riggedFace.eye.l * 1.3);
        Blendshape.setValue(PresetName.BlinkRight, riggedFace.eye.r * 1.3);

        // Interpolate and set mouth blendshapes
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

        // PUPILS
        // interpolate pupil and keep a copy of the value
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
            // console.log(rotation)
            const Part = this.gltf.humanoid.getRawBoneNode(name);

            if (!Part) {
                return;
            }
            // if (consoleNumber < 100) {
            //     console.log("oldQuaternion", Part.quaternion);
                
            //     consoleNumber++;
            // }
            let euler = new THREE.Euler(
                rotation.x * dampener,
                rotation.y * dampener,
                rotation.z * dampener,
            );

            let quaternion = new THREE.Quaternion().setFromEuler(euler);
            // if (consoleNumber < 100) {
            //     console.log("getRawBoneNode", Part);
            //     console.log("getRawBoneNode", quaternion);
            //     console.log("check", rotation);
            //     console.log("lerpAmount", lerpAmount);
            //     consoleNumber++;
            // }
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
            // URL of the model you want to load
            url,
            // Callback when the resource is loaded
            (gltf) => {
                const vrm = gltf.userData.vrm;
                // calling these functions greatly improves the performance
                VRMUtils.removeUnnecessaryVertices(gltf.scene);
                VRMUtils.removeUnnecessaryJoints(gltf.scene);
                // Disable frustum culling
                vrm.scene.traverse((obj) => {
                    obj.frustumCulled = false;
                });
                // console.log(vrm.scene);
                // if (this.gltf) {
                //   // Reset GLTF and morphTargetMeshes if a previous model was loaded.
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
                // console.log(this.gltf.humanoid.getRawBoneNode('neck').quaternion);
                // var neckBone = this.gltf.humanoid.getRawBoneNode('neck');
                // neckBone.rotation.set(0, 0.1, 0.1);
                // Update the matrix of the 'neck' bone
                // neckBone.updateMatrix();

                // Update the world matrix of the entire model
                // vrm.updateMatrixWorld(true);
                this.render();
                // this.scene.add(gltf.scene);
                this.init(vrm);
            },

            // Called while loading is progressing
            (progress) =>
                console.log(
                    "Loading model...",
                    100.0 * (progress.loaded / progress.total),
                    "%"
                ),
            // Called when loading has errors
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
            // Register first bone found as the root
            if (object.isBone && !this.root) {
                this.root = object;
                // console.log(object);
            }
            // Return early if no mesh is found.
            if (!(object).isMesh) {
                // console.warn(`No mesh found`);
                return;
            }

            const mesh = object;
            // Reduce clipping when model is close to camera.
            mesh.frustumCulled = false;

            // Return early if mesh doesn't include morphable targets
            if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
                // console.warn(`Mesh ${mesh.name} does not have morphable targets`);
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
                    // vrmNewExpressionBrowLeftDown.overrideBlink = "block";
                    // vrmNewExpressionBrowLeftDown.overrideMouth = "block";
                    vrmSet.expressionManager.registerExpression(vrmNewExpressionBrowLeftDown);
                    // Object.keys(listData).forEach(function (key, index) {
                    //     var listSkin = listData[key];
                    //     var expressionA = vrmSet.expressionManager.getExpression(`${key}A`);
                    //     var expressionI = vrmSet.expressionManager.getExpression(`${key}I`);
                    //     var expressionU = vrmSet.expressionManager.getExpression(`${key}U`);
                    //     var expressionE = vrmSet.expressionManager.getExpression(`${key}E`);
                    //     var expressionO = vrmSet.expressionManager.getExpression(`${key}O`);
                    //     var vrmNewExpressionA = new VRMExpression(`${key}A`);
                    //     var vrmNewExpressionI = new VRMExpression(`${key}I`);
                    //     var vrmNewExpressionU = new VRMExpression(`${key}U`);
                    //     var vrmNewExpressionE = new VRMExpression(`${key}E`);
                    //     var vrmNewExpressionO = new VRMExpression(`${key}O`);
                    //     listSkin.forEach(item => {
                    //         var index = item.index;
                    //         var weight = item.weight;
                    //         if (index < 39 || index > 42) {
                    //             vrmNewExpressionA.addBind(new VRMExpressionMorphTargetBind({ index, primitives: listSkinFaceMesh, weight }));
                    //             vrmNewExpressionE.addBind(new VRMExpressionMorphTargetBind({ index, primitives: listSkinFaceMesh, weight }));
                    //             vrmNewExpressionI.addBind(new VRMExpressionMorphTargetBind({ index, primitives: listSkinFaceMesh, weight }));
                    //             vrmNewExpressionO.addBind(new VRMExpressionMorphTargetBind({ index, primitives: listSkinFaceMesh, weight }));
                    //             vrmNewExpressionU.addBind(new VRMExpressionMorphTargetBind({ index, primitives: listSkinFaceMesh, weight }));
                    //         }
                    //     });
                    //     vrmNewExpressionA.addBind(new VRMExpressionMorphTargetBind({ index: 39, primitives: listSkinFaceMesh, weight: 1 }));
                    //     vrmNewExpressionE.addBind(new VRMExpressionMorphTargetBind({ index: 42, primitives: listSkinFaceMesh, weight: 1 }));
                    //     vrmNewExpressionI.addBind(new VRMExpressionMorphTargetBind({ index: 40, primitives: listSkinFaceMesh, weight: 1 }));
                    //     vrmNewExpressionO.addBind(new VRMExpressionMorphTargetBind({ index: 43, primitives: listSkinFaceMesh, weight: 1 }));
                    //     vrmNewExpressionU.addBind(new VRMExpressionMorphTargetBind({ index: 41, primitives: listSkinFaceMesh, weight: 1 }));
                    //     vrmNewExpressionA.overrideBlink = "block";
                    //     vrmNewExpressionE.overrideBlink = "block";
                    //     vrmNewExpressionI.overrideBlink = "block";
                    //     vrmNewExpressionO.overrideBlink = "block";
                    //     vrmNewExpressionU.overrideBlink = "block";
                    //     vrmNewExpressionA.overrideMouth = "block";
                    //     vrmNewExpressionE.overrideMouth = "block";
                    //     vrmNewExpressionI.overrideMouth = "block";
                    //     vrmNewExpressionO.overrideMouth = "block";
                    //     vrmNewExpressionU.overrideMouth = "block";
                    //     if (expressionA) {
                    //         vrmSet.expressionManager.unregisterExpression(expressionA);
                    //     }
                    //     if (expressionI) {
                    //         vrmSet.expressionManager.unregisterExpression(expressionI);
                    //     }
                    //     if (expressionU) {
                    //         vrmSet.expressionManager.unregisterExpression(expressionU);
                    //     }
                    //     if (expressionE) {
                    //         vrmSet.expressionManager.unregisterExpression(expressionE);
                    //     }
                    //     if (expressionO) {
                    //         vrmSet.expressionManager.unregisterExpression(expressionO);
                    //     }
                    //     vrmSet.expressionManager.registerExpression(vrmNewExpressionA);
                    //     vrmSet.expressionManager.registerExpression(vrmNewExpressionE);
                    //     vrmSet.expressionManager.registerExpression(vrmNewExpressionI);
                    //     vrmSet.expressionManager.registerExpression(vrmNewExpressionO);
                    //     vrmSet.expressionManager.registerExpression(vrmNewExpressionU);
                    // });
                    break;
                }
            }

        }
    };

    updateHand(landmarks) {
        // if (consoleNumber < 2) {
        //     console.log("landmark", landmarks);
        //     consoleNumber++;
        // }


    }

    updateHandLeft(leftHandLandmarks) {
        var riggedLeftHand = Kalidokit.Hand.solve(leftHandLandmarks, 'Left');
        if (riggedLeftHand && this.riggedPose) {
        //   this.rigRotation('leftHand', {
        //     // Combine pose rotation Z and hand rotation X Y
        //     z: this.riggedPose.LeftHand.z,
        //     y: riggedLeftHand.LeftWrist.y,
        //     x: riggedLeftHand.LeftWrist.x,
        //   });
          this.rigRotation('leftRingProximal', riggedLeftHand.LeftRingProximal);
          this.rigRotation('leftRingIntermediate', riggedLeftHand.LeftRingIntermediate);
          this.rigRotation('leftRingDistal', riggedLeftHand.LeftRingDistal);
          this.rigRotation('leftIndexProximal', riggedLeftHand.LeftIndexProximal);
          this.rigRotation('leftIndexIntermediate', riggedLeftHand.LeftIndexIntermediate);
          this.rigRotation('leftIndexDistal', riggedLeftHand.LeftIndexDistal);
          this.rigRotation('leftMiddleProximal', riggedLeftHand.LeftMiddleProximal);
          this.rigRotation('leftMiddleIntermediate', riggedLeftHand.LeftMiddleIntermediate);
          this.rigRotation('leftMiddleDistal', riggedLeftHand.LeftMiddleDistal);
          this.rigRotation('leftThumbProximal', riggedLeftHand.LeftThumbProximal);
          this.rigRotation('leftThumbDistal', riggedLeftHand.LeftThumbDistal);
          this.rigRotation('leftLittleProximal', riggedLeftHand.LeftLittleProximal);
          this.rigRotation('leftLittleIntermediate', riggedLeftHand.LeftLittleIntermediate);
          this.rigRotation('leftLittleDistal', riggedLeftHand.LeftLittleDistal);
        }
    }

    updateHandRight(rightHandLandmarks) {
        var riggedRightHand = Kalidokit.Hand.solve(rightHandLandmarks, 'Right');
        if (riggedRightHand && this.riggedPose) {
        //   this.rigRotation('rightHand', {
        //     // Combine Z axis from pose hand and X/Y axis from hand wrist rotation
        //     z: this.riggedPose.RightHand.z,
        //     y: riggedRightHand.RightWrist.y,
        //     x: riggedRightHand.RightWrist.x,
        //   });
          this.rigRotation('rightRingProximal', riggedRightHand.RightRingProximal);
          this.rigRotation('rightRingIntermediate', riggedRightHand.RightRingIntermediate);
          this.rigRotation('rightRingDistal', riggedRightHand.RightRingDistal);
          this.rigRotation('rightIndexProximal', riggedRightHand.RightIndexProximal);
          this.rigRotation('rightIndexIntermediate', riggedRightHand.RightIndexIntermediate);
          this.rigRotation('rightIndexDistal', riggedRightHand.RightIndexDistal);
          this.rigRotation('rightMiddleProximal', riggedRightHand.RightMiddleProximal);
          this.rigRotation('rightMiddleIntermediate', riggedRightHand.RightMiddleIntermediate);
          this.rigRotation('rightMiddleDistal', riggedRightHand.RightMiddleDistal);
          this.rigRotation('rightThumbProximal', riggedRightHand.RightThumbProximal);
          this.rigRotation('rightThumbDistal', riggedRightHand.RightThumbDistal);
          this.rigRotation('rightLittleProximal', riggedRightHand.RightLittleProximal);
          this.rigRotation('rightLittleIntermediate', riggedRightHand.RightLittleIntermediate);
          this.rigRotation('rightLittleDistal', riggedRightHand.RightLittleDistal);
        }
    }

    updateBody(landmarks, worldLandMarks) {
        this.riggedPose = Kalidokit.Pose.solve(worldLandMarks,landmarks, {
            runtime: 'mediapipe',
            video: video,
        });
       
        if (this.riggedPose) {
            // this.rigRotation('hips', riggedPose.Hips.rotation, 0.7);
            // this.rigPosition(
            //     'hips',
            //     {
            //         x: -riggedPose.Hips.position.x, // Reverse direction
            //         y: riggedPose.Hips.position.y + 1, // Add a bit of height
            //         z: -riggedPose.Hips.position.z, // Reverse direction
            //     },
            //     1,
            //     0.07,
            // );

            this.rigRotation('chest', this.riggedPose.Chest, 0.25, 0.3);
            this.rigRotation('spine', this.riggedPose.Spine, 0.45, 0.3);

            this.rigRotation('leftUpperArm', this.riggedPose.LeftUpperArm, 1, 0.3);
            this.rigRotation('leftLowerArm', this.riggedPose.LeftLowerArm, 1, 0.3);
            this.rigRotation('rightUpperArm', this.riggedPose.RightUpperArm, 1, 0.3);
            this.rigRotation('rightLowerArm', this.riggedPose.RightLowerArm, 1, 0.3);

            // this.rigRotation('leftUpperLeg', riggedPose.LeftUpperLeg, 1, 0.3);
            // this.rigRotation('leftLowerLeg', riggedPose.LeftLowerLeg, 1, 0.3);
            // this.rigRotation('rightUpperLeg', riggedPose.RightUpperLeg, 1, 0.3);
            // this.rigRotation('rightLowerLeg', riggedPose.RightLowerLeg, 1, 0.3);
        }
    }


    updateBlendshapes(blendshapes) {
        if (blendshapes.length > 0) {
            // const { annotations } = predictions[0];

            // const [topX, topY] = annotations['midwayBetweenEyes'][0];

            // const [rightX, rightY] = annotations['rightCheek'][0];
            // const [leftX, leftY] = annotations['leftCheek'][0];
            // const bottomX = (rightX + leftX) / 2;
            // const bottomY = (rightY + leftY) / 2;

            // const degree = Math.atan((topY - bottomY) / (topX - bottomX));

            // console.log(degree);
        }
        // if (!isShow) {
        //     console.log(`Góc nghiêng của đầu là: ${angle.toFixed(2)} độ`);
        //     isShow = true;
        // }
        for (const blendshape of blendshapes) {
            if (blendshape.categoryName == 'eyeBlinkLeft') {
                var value = blendshape.score * 2;
                if (value > 1) {
                    value = 1;
                }
                if (value < 0.1) {
                    value = 0.1;
                }
                // console.log(value);
                // console.log(this.gltf.expressionManager);
                this.gltf.expressionManager.setValue("BrowLeftDown", value);
                this.gltf.expressionManager.setValue("blinkLeft", value);
            }
            if (blendshape.categoryName == 'eyeBlinkRight') {
                var value = blendshape.score * 2;
                if (value > 1) {
                    value = 1;
                }
                if (value < 0.1) {
                    value = 0.1;
                }
                // console.log(value);
                // console.log(this.gltf.expressionManager);
                this.gltf.expressionManager.setValue("BrowLeftDown", value);
                this.gltf.expressionManager.setValue("blinkRight", value);
            }
            // console.log(name);

            // if (!Object.keys(mesh.morphTargetDictionary).includes(name)) {
            //     // console.warn(`Model morphable target ${name} not found`);
            //     continue;
            // }

            // const idx = mesh.morphTargetDictionary[name];
            // mesh.morphTargetInfluences[idx] = value;
        }
        // for (const mesh of this.morphTargetMeshes) {
        //     if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
        //         console.warn(`Mesh ${mesh.name} does not have morphable targets`);
        //         continue;
        //     }
        //     //   console.log(mesh.morphTargetDictionary)
        //     for (const [name, value] of blendshapes) {
        //         // console.log(name);
        //         if (!Object.keys(mesh.morphTargetDictionary).includes(name)) {
        //             // console.warn(`Model morphable target ${name} not found`);
        //             continue;
        //         }

        //         const idx = mesh.morphTargetDictionary[name];
        //         mesh.morphTargetInfluences[idx] = value;
        //     }
        // }
    }

    /**
     * Apply a position, rotation, scale matrix to current GLTF.scene
     * @param matrix
     * @param matrixRetargetOptions
     * @returns
     */
    applyMatrix(
        matrix,
        matrixRetargetOptions
    ) {
        const { decompose = false, scale = 1 } = matrixRetargetOptions || {};
        if (!this.gltf) {
            return;
        }
        // Three.js will update the object matrix when it render the page
        // according the object position, scale, rotation.
        // To manually set the object matrix, you have to set autoupdate to false.
        matrix.scale(new THREE.Vector3(scale, scale, scale));
        this.gltf.scene.matrixAutoUpdate = false;
        let head = this.gltf.scene.getObjectByName('Face');
        // console.log(head);
        if (head) {
            // Create a new object and copy all properties from "Head"
            let newHead = head.clone();
            newHead.matrix.copy(matrix);
            newHead.updateMatrixWorld(true);
            // Remove the old "Head" from the scene
            head.parent.remove(head);
            // Add the new "Head" to the scene
            this.gltf.scene.add(newHead);
        }
        // Set new position and rotation from matrix
        // this.gltf.scene.matrix.copy(matrix);
    }

    /**
     * Takes the root object in the avatar and offsets its position for retargetting.
     * @param offset
     * @param rotation
     */
    offsetRoot(offset, rotation) {
        if (this.root) {
            this.root.position.copy(offset);
            if (rotation) {
                let offsetQuat = new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(rotation.x, rotation.y, rotation.z)
                );
                this.root.quaternion.copy(offsetQuat);
            }
        }
    }
}

let faceLandmarker;
let poseLandmarker;
let handLandmarker;
let holisticLandmarker;
let video;

const scene = new BasicScene();
const avatar = new Avatar(
    "./Ayame_Shiratori_normal.vrm",
    scene.scene
);
function detectHandLandmarks(time) {
    // if (consoleNumber < 3) {
    //     console.log("landmark", handLandmarker);
    //     consoleNumber++;
    // }

    if (!handLandmarker) {
        return;
    }
    const landmark = handLandmarker.detectForVideo(video, time);
    if (consoleNumber < 100) {
        console.log("landmark", landmark);
        consoleNumber++;
    }
    avatar.updateHand(landmark);
}

function detectPoseLandmarks(time) {
    if (!poseLandmarker) {
        return;
    }
    const landmark = poseLandmarker.detectForVideo(video, time);

    // Apply transformation
    // const transformationMatrices = landmarks.facialTransformationMatrixes;
    // if (transformationMatrices && transformationMatrices.length > 0) {
    //     let matrix = new THREE.Matrix4().fromArray(transformationMatrices[0].data);
    //     // Example of applying matrix directly to the avatar
    //     avatar.applyMatrix(matrix, { scale: 40 });
    // }
    // return;

    // Apply Blendshapes
    const landmarks = landmark.poseLandmarks;
    const worldLandmarks = landmark.poseWorldLandmarks;

    if (landmarks && worldLandmarks && landmarks.length > 0 && worldLandmarks.length > 0) {
        // const coefsMap = retarget(blendshapes);
        avatar.updateBody(landmarks, worldLandmarks);
    }
}
var consoleNumber = 0;
function detectFaceLandmarks(time) {
    if (!faceLandmarker) {
        return;
    }
    const landmarks = faceLandmarker.detectForVideo(video, time);
    if (landmarks && landmarks.faceLandmarks.length > 0 && landmarks.faceLandmarks[0].length > 0) {
        var riggedFace = Kalidokit.Face.solve(landmarks.faceLandmarks[0], {
            runtime: 'mediapipe',
            video: video,
            blinkSettings: [0, 1]
        });
        // console.log(landmarks.faceLandmarks);
        if (riggedFace) {
            avatar.rigFace(riggedFace);
        }
    }

    // Apply transformation
    // const transformationMatrices = landmarks.facialTransformationMatrixes;
    // if (transformationMatrices && transformationMatrices.length > 0) {
    //     let matrix = new THREE.Matrix4().fromArray(transformationMatrices[0].data);
    //     // Example of applying matrix directly to the avatar
    //     avatar.applyMatrix(matrix, { scale: 40 });
    // }
    // return;

    // Apply Blendshapes
    // const blendshapes = landmarks.faceBlendshapes;
    // if (blendshapes && blendshapes.length > 0) {
    //     // const coefsMap = retarget(blendshapes);
    //     avatar.updateBlendshapes(blendshapes[0].categories);
    // }
}


const getEyeOpen = (lm, side = LEFT, { high = 1, low = 0 } = {}) => {
    const eyePoints = points.eye[side];
    const eyeDistance = eyeLidRatio(lm[eyePoints[0]], lm[eyePoints[1]], lm[eyePoints[2]], lm[eyePoints[3]], lm[eyePoints[4]], lm[eyePoints[5]], lm[eyePoints[6]], lm[eyePoints[7]]);
    const maxRatio = 0.285;

    const ratio = clamp(eyeDistance / maxRatio, 0, 2);
    const eyeOpenRatio = remap(ratio, low, high);
    return {
        normal: eyeOpenRatio,
        raw: ratio
    };
};

const eyeLidRatio = (eyeOuterCorner, eyeInnerCorner, eyeOuterUpperLid, eyeMidUpperLid, eyeInnerUpperLid, eyeOuterLowerLid, eyeMidLowerLid, eyeInnerLowerLid) => {
    eyeOuterCorner = new Kalidokit.Vector(eyeOuterCorner);
    eyeInnerCorner = new Kalidokit.Vector(eyeInnerCorner);
    eyeOuterUpperLid = new Kalidokit.Vector(eyeOuterUpperLid);
    eyeMidUpperLid = new Kalidokit.Vector(eyeMidUpperLid);
    eyeInnerUpperLid = new Kalidokit.Vector(eyeInnerUpperLid);
    eyeOuterLowerLid = new Kalidokit.Vector(eyeOuterLowerLid);
    eyeMidLowerLid = new Kalidokit.Vector(eyeMidLowerLid);
    eyeInnerLowerLid = new Kalidokit.Vector(eyeInnerLowerLid);
    const eyeWidth = eyeOuterCorner.distance(eyeInnerCorner, 2);
    const eyeOuterLidDistance = eyeOuterUpperLid.distance(eyeOuterLowerLid, 2);
    const eyeMidLidDistance = eyeMidUpperLid.distance(eyeMidLowerLid, 2);
    const eyeInnerLidDistance = eyeInnerUpperLid.distance(eyeInnerLowerLid, 2);
    const eyeLidAvg = (eyeOuterLidDistance + eyeMidLidDistance + eyeInnerLidDistance) / 3;
    const ratio = eyeLidAvg / eyeWidth;
    return ratio;
};



var isShow = false;
function retarget(blendshapes) {

    const categories = blendshapes[0].categories;

    let coefsMap = new Map();
    for (let i = 0; i < categories.length; ++i) {
        const blendshape = categories[i];
        // Adjust certain blendshape values to be less prominent.
        switch (blendshape.categoryName) {
            case "browOuterUpLeft":
                blendshape.score *= 1.2;
                break;
            case "browOuterUpRight":
                blendshape.score *= 1.2;
                break;
            case "eyeBlinkLeft":

                blendshape.score *= 1.2;
                break;
            case "eyeBlinkRight":
                blendshape.score *= 1.2;
                break;
            default:
        }
        coefsMap.set(blendshape.categoryName, blendshape.score);
    }
    return coefsMap;
}

function onVideoFrame(time) {
    // Do something with the frame.
    // detectFaceLandmarks(time);
    // detectPoseLandmarks(time);
    detectHolasticLandmarks(time);
    // Re-register the callback to be notified about the next frame.
    video.requestVideoFrameCallback(onVideoFrame);
}

function detectHolasticLandmarks(time) {
    if (!holisticLandmarker) {
        return;
    }
    const landmark = holisticLandmarker.detectForVideo(video, time);
    
    // Apply transformation
    // const transformationMatrices = landmarks.facialTransformationMatrixes;
    // if (transformationMatrices && transformationMatrices.length > 0) {
    //     let matrix = new THREE.Matrix4().fromArray(transformationMatrices[0].data);
    //     // Example of applying matrix directly to the avatar
    //     avatar.applyMatrix(matrix, { scale: 40 });
    // }
    // return;

    // Apply Blendshapes
    const landmarks = landmark.poseLandmarks;
    const worldLandmarks = landmark.poseWorldLandmarks;
    const faceLandmarks = landmark.faceLandmarks;
    const leftHandLandmarks = landmark.rightHandLandmarks;
    const rightHandLandmarks = landmark.leftHandLandmarks;
    if (consoleNumber < 30) {
        console.log('faceLandmarks', landmark);
        console.log('leftHandLandmarks', leftHandLandmarks);
        console.log('rightHandLandmarks', rightHandLandmarks);
        consoleNumber++;
     }
    if (landmarks && worldLandmarks && landmarks.length > 0 && worldLandmarks.length > 0) {
        // const coefsMap = retarget(blendshapes);

        // avatar.updateHand(landmarks[0], worldLandmarks[0]);

        avatar.updateBody(landmarks[0], worldLandmarks[0]);
    }
    if(leftHandLandmarks && leftHandLandmarks.length > 0){
        avatar.updateHandLeft(leftHandLandmarks[0])
    }  
    if(rightHandLandmarks && rightHandLandmarks.length > 0){
        avatar.updateHandRight(rightHandLandmarks[0])
    }  
    if(faceLandmarks && faceLandmarks.length > 0){

        var riggedFace = Kalidokit.Face.solve(faceLandmarks[0], {
            runtime: 'mediapipe',
            video: video
        });
        avatar.rigFace(riggedFace)
    }   
}

// Stream webcam into landmarker loop (and also make video visible)
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
    // faceLandmarker = await FaceLandmarker.createFromModelPath(
    //     vision,
    //     "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
    // );
    // await faceLandmarker.setOptions({
    //     baseOptions: {
    //         delegate: "GPU"
    //     },
    //     runningMode: "VIDEO",
    //     outputFaceBlendshapes: true,
    //     outputFacialTransformationMatrixes: true
    // });

    // poseLandmarker = await PoseLandmarker.createFromModelPath(vision,
    //     "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
    // );
    // await poseLandmarker.setOptions({
    //     baseOptions: {
    //         delegate: "GPU"
    //     },
    //     runningMode: "VIDEO"
    // });
    // handLandmarker = await HandLandmarker.createFromModelPath(vision,
    //     "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
    // );
    // console.log(handLandmarker);
    // await handLandmarker.setOptions({
    //     baseOptions: {
    //         delegate: "GPU"
    //     },
    //     runningMode: "VIDEO"
    // });

    console.log("Finished Loading MediaPipe Model.");
}

runDemo();