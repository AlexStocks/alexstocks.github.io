// https://segmentfault.com/a/1190000002807674
var disqus_shortname = 'alexstocks'; // Required - Replace example with your forum shortname
var disqus_identifier = window.location.pathname; //'a unique identifier for each page where Disqus is present';
var disqus_title = document.title; // 'a unique title for each page where Disqus is present';
var disqus_url = document.URL; // window.location.origin + window.location.pathname; // 'a unique URL for each page where Disqus is present';
var disqus_config = function () {
this.page.url = window.location.href; // Replace PAGE_URL with your page's canonical URL variable
this.page.identifier = window.location.pathname; // Replace PAGE_IDENTIFIER with your page's unique identifier variable
};

(function() {
var dsq = document.createElement('script'); dsq.type = 'text/javascript'; dsq.async = true;
dsq.src = '//' + disqus_shortname + '.disqus.com/embed.js'; dsq.setAttribute('data-timestamp', +new Date());
(document.getElementsByTagName('head')[0] || document.getElementsByTagName('body')[0]).appendChild(dsq);
})();
</script>
<noscript>Please enable JavaScript to view the <a href="https://disqus.com/?ref_noscript" rel="nofollow">comments powered by Disqus.</a></noscript>
<script id="dsq-count-scr" src='//' + disqus_shortname + '.disqus.com/count.js' async></script>