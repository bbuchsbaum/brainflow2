<!--
  Simple Icon Component wrapper
  Can be replaced with any icon library
-->
<script lang="ts">
  export let name: string;
  export let size: number = 16;
  export let color: string = 'currentColor';
</script>

<!-- 
  This is a placeholder - in production, you'd use an icon library
  For now, just using the Lucide icons that are already imported
-->
<slot />

<style>
  /* Icon styles would go here if needed */
</style>