<script lang="ts">
	import { onMount } from 'svelte';
	import * as THREE from 'three';

	let { canvas = $bindable<HTMLCanvasElement>() } = $props();
	let failure = $state('');
	let reset = () => {};
	let step = (_forward: number, _side: number, _turn: number) => {};
	let look = (_dx: number, _dy: number) => {};
	const keys = new Set<string>();
	let dragging = false;
	onMount(() => {
		if (!canvas) return;
		let renderer: THREE.WebGLRenderer;
		try {
			renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
		} catch {
			failure = 'The room needs WebGL. Enable browser graphics acceleration or use the webcam.';
			return;
		}
		renderer.setSize(960, 540, false);
		renderer.setPixelRatio(1);
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		const scene = new THREE.Scene();
		scene.background = new THREE.Color('#d8e1e6');
		const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.05, 60);
		camera.rotation.order = 'YXZ';
		scene.add(new THREE.HemisphereLight(0xffffff, 0x8b735b, 2.4));
		const light = new THREE.DirectionalLight(0xffffff, 2);
		light.position.set(3, 8, 4);
		scene.add(light);
		const obstacles: { x: number; z: number; width: number; depth: number }[] = [];
		function box(
			x: number,
			y: number,
			z: number,
			width: number,
			height: number,
			depth: number,
			color: string,
			solid = false
		) {
			const mesh = new THREE.Mesh(
				new THREE.BoxGeometry(width, height, depth),
				new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
			);
			mesh.position.set(x, y, z);
			scene.add(mesh);
			if (solid) obstacles.push({ x, z, width, depth });
			return mesh;
		}
		function sign(text: string, x: number, y: number, z: number, width = 1.8, angle = 0) {
			const image = document.createElement('canvas');
			image.width = 768;
			image.height = 160;
			const ctx = image.getContext('2d')!;
			ctx.fillStyle = '#faf7ef';
			ctx.fillRect(0, 0, 768, 160);
			ctx.fillStyle = '#232a2f';
			ctx.font = 'bold 48px sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(text, 384, 80);
			const texture = new THREE.CanvasTexture(image);
			texture.colorSpace = THREE.SRGBColorSpace;
			const mesh = new THREE.Mesh(
				new THREE.PlaneGeometry(width, (width * 160) / 768),
				new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
			);
			mesh.position.set(x, y, z);
			mesh.rotation.y = angle;
			scene.add(mesh);
		}
		box(0, -0.1, 0, 12, 0.2, 12, '#c5b59c');
		const grid = new THREE.GridHelper(12, 12, '#a69883', '#baab94');
		grid.position.y = 0.005;
		scene.add(grid);
		box(0, 2, -6, 12, 4, 0.2, '#eee9dc');
		box(-6, 2, 0, 0.2, 4, 12, '#e3e8e5');
		box(6, 2, 0, 0.2, 4, 12, '#ece2d9');
		box(0, 2, 6, 12, 4, 0.2, '#eee9dc');
		sign('NORTH GALLERY', 0, 3.2, -5.86, 4);
		box(0, 1.9, -5.8, 2.5, 1.8, 0.15, '#3d3431');
		box(0, 1.9, -5.69, 2.25, 1.55, 0.04, '#f2ddba');
		const sun = new THREE.Mesh(
			new THREE.CircleGeometry(0.54, 48),
			new THREE.MeshBasicMaterial({ color: '#d93729' })
		);
		sun.position.set(0, 1.95, -5.65);
		scene.add(sun);
		sign('RED SUN · 1924', 0, 0.72, -5.65, 2.4);
		box(-3.4, 0.45, -2.4, 1.1, 0.9, 1.1, '#e9e6df', true);
		const vase = new THREE.Mesh(
			new THREE.SphereGeometry(0.42, 32, 24),
			new THREE.MeshStandardMaterial({ color: '#1565c0', roughness: 0.25 })
		);
		vase.scale.y = 1.3;
		vase.position.set(-3.4, 1.4, -2.4);
		scene.add(vase);
		const neck = new THREE.Mesh(
			new THREE.CylinderGeometry(0.18, 0.22, 0.4, 32),
			new THREE.MeshStandardMaterial({ color: '#1565c0' })
		);
		neck.position.set(-3.4, 1.94, -2.4);
		scene.add(neck);
		sign('BLUE VASE', -3.4, 0.65, -1.83, 1);
		box(3.4, 0.45, -2.4, 1.2, 0.9, 1.2, '#e9e6df', true);
		const cube = box(3.4, 1.45, -2.4, 0.85, 0.85, 0.85, '#e8b522');
		cube.rotation.y = Math.PI / 6;
		sign('GOLDEN CUBE', 3.4, 0.65, -1.78, 1.1);
		box(0, 1.3, 0, 2.8, 2.6, 0.25, '#728c79', true);
		sign('AROUND THE CORNER', 0, 1.7, 0.14, 2.6);
		sign('SECRET NUMBER: 42', 0, 1.7, -0.14, 2.6, Math.PI);
		box(4.2, 0.3, 2.5, 2, 0.6, 0.7, '#985632', true);
		sign('REST HERE', 5.86, 1.7, 2.5, 1.8, -Math.PI / 2);
		box(-4, 1.2, 5.85, 1.6, 2.4, 0.1, '#306d91');
		sign('EXIT', -4, 2.65, 5.76, 1.2, Math.PI);
		let yaw = 0,
			pitch = 0;
		function render() {
			camera.rotation.set(pitch, yaw, 0);
			renderer.render(scene, camera);
		}
		reset = () => {
			camera.position.set(0, 1.65, 4.7);
			yaw = 0;
			pitch = 0;
			keys.clear();
			render();
		};
		step = (forward, side, turn) => {
			yaw += turn;
			const x = camera.position.x + side * Math.cos(yaw) - forward * Math.sin(yaw);
			const z = camera.position.z - forward * Math.cos(yaw) - side * Math.sin(yaw);
			const free = (x: number, z: number) =>
				Math.abs(x) < 5.6 &&
				Math.abs(z) < 5.6 &&
				!obstacles.some(
					(o) => Math.abs(x - o.x) < o.width / 2 + 0.25 && Math.abs(z - o.z) < o.depth / 2 + 0.25
				);
			if (free(x, camera.position.z)) camera.position.x = x;
			if (free(camera.position.x, z)) camera.position.z = z;
			render();
		};
		look = (dx, dy) => {
			yaw -= dx * 0.004;
			pitch = Math.max(-0.8, Math.min(0.8, pitch - dy * 0.004));
			render();
		};
		reset();
		let last = performance.now(),
			animation = 0;
		function tick(now: number) {
			const dt = Math.min((now - last) / 1000, 0.05);
			last = now;
			step(
				((keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0)) * dt * 2.4,
				((keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0)) * dt * 2.4,
				((keys.has('arrowleft') ? 1 : 0) - (keys.has('arrowright') ? 1 : 0)) * dt * 1.5
			);
			animation = requestAnimationFrame(tick);
		}
		animation = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(animation);
			keys.clear();
			scene.traverse((object) => {
				if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
					object.geometry.dispose();
					for (const material of Array.isArray(object.material)
						? object.material
						: [object.material]) {
						if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
						material.dispose();
					}
				}
			});
			renderer.dispose();
		};
	});
</script>

<section class="space-y-3 rounded-xl border border-neutral-200 p-4" aria-label="Room simulator">
	<div class="flex items-center justify-between gap-3">
		<h2 class="font-medium">Room simulator</h2>
		<button type="button" onclick={() => reset()}>Reset view</button>
	</div>
	<p class="text-sm text-neutral-600">
		Click the room, then use W A S D to walk. Drag to look, or use ← → to turn. The AI sees only the
		rendered view.
	</p>
	{#if failure}<p role="alert">{failure}</p>{/if}
	<canvas
		bind:this={canvas}
		class="aspect-video max-h-[420px] w-full rounded-lg bg-neutral-100 object-contain outline-offset-2"
		aria-label="Walkable gallery"
		tabindex="0"
		onkeydown={(e) => {
			const key = e.key.toLowerCase();
			if (['w', 'a', 's', 'd', 'arrowleft', 'arrowright'].includes(key)) {
				e.preventDefault();
				keys.add(key);
			}
		}}
		onkeyup={(e) => keys.delete(e.key.toLowerCase())}
		onblur={() => {
			keys.clear();
			dragging = false;
		}}
		onpointerdown={(e) => {
			canvas?.focus();
			dragging = true;
			canvas?.setPointerCapture(e.pointerId);
		}}
		onpointerup={() => (dragging = false)}
		onpointercancel={() => (dragging = false)}
		onpointermove={(e) => {
			if (dragging) look(e.movementX, e.movementY);
		}}
	></canvas>
	<div class="flex flex-wrap gap-2">
		<button type="button" onclick={() => step(0, 0, 0.3)}>Turn left</button>
		<button type="button" onclick={() => step(0.6, 0, 0)}>Forward</button>
		<button type="button" onclick={() => step(-0.6, 0, 0)}>Back</button>
		<button type="button" onclick={() => step(0, 0, -0.3)}>Turn right</button>
		<button type="button" onclick={() => step(0, -0.6, 0)}>Step left</button>
		<button type="button" onclick={() => step(0, 0.6, 0)}>Step right</button>
	</div>
	<p class="text-xs text-neutral-500">
		Try: “What can you see?” Walk around the partition, inspect an exhibit, then turn away and ask
		what you passed.
	</p>
</section>

<style>
	button {
		border: 1px solid #d4d4d4;
		border-radius: 6px;
		padding: 6px 10px;
		font-size: 14px;
		background: white;
	}
	canvas {
		touch-action: none;
	}
</style>
