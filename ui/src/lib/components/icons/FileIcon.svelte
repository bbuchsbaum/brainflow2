<script lang="ts">
	import {
		Folder,
		FolderOpen,
		File,
		FileImage,
		FileText,
		Brain,
		FileCode,
		FileJson
	} from 'lucide-svelte';
	
	interface Props {
		fileName: string;
		isDirectory: boolean;
		isOpen?: boolean;
		class?: string;
	}
	
	let { fileName, isDirectory, isOpen = false, class: className = '' }: Props = $props();
	
	// Determine icon based on file type
	const icon = $derived(
		isDirectory 
			? (isOpen ? FolderOpen : Folder)
			: fileName.toLowerCase().endsWith('.nii') || fileName.toLowerCase().endsWith('.nii.gz')
			? Brain
			: fileName.toLowerCase().endsWith('.gii') || fileName.toLowerCase().endsWith('.gii.gz')
			? Brain
			: fileName.toLowerCase().match(/\.(png|jpg|jpeg|gif|bmp|svg)$/)
			? FileImage
			: fileName.toLowerCase().match(/\.(csv|tsv|txt)$/)
			? FileText
			: fileName.toLowerCase().match(/\.(json|yaml|yml)$/)
			? FileJson
			: fileName.toLowerCase().match(/\.(js|ts|py|r|m)$/)
			? FileCode
			: File
	);
	
	// Color based on file type
	const iconColor = $derived(
		isDirectory
			? 'text-blue-600 dark:text-blue-400'
			: fileName.toLowerCase().match(/\.(nii|nii\.gz|gii|gii\.gz)$/)
			? 'text-purple-600 dark:text-purple-400'
			: fileName.toLowerCase().match(/\.(png|jpg|jpeg|gif|bmp|svg)$/)
			? 'text-green-600 dark:text-green-400'
			: fileName.toLowerCase().match(/\.(csv|tsv|txt)$/)
			? 'text-orange-600 dark:text-orange-400'
			: fileName.toLowerCase().match(/\.(json|yaml|yml|js|ts|py|r|m)$/)
			? 'text-cyan-600 dark:text-cyan-400'
			: 'text-gray-600 dark:text-gray-400'
	);
</script>

<svelte:component 
	this={icon} 
	class="{iconColor} {className}"
	size={16}
	strokeWidth={2}
/>