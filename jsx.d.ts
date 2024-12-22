declare type InstancePropsWithClassName<T extends Instance> =
	React.InstanceProps<T> & {
		className?: string;
	};

declare type TextInstancePropsWithClassName<T extends Instance> = Omit<
	InstancePropsWithClassName<T>,
	"children"
> & {
	children?: string | React.ReactNode;
};

declare namespace JSX {
	// Aliases
	interface IntrinsicElements {
		body: InstancePropsWithClassName<ScreenGui>;
		div: InstancePropsWithClassName<Frame>;
		span: TextInstancePropsWithClassName<TextLabel>;
		p: TextInstancePropsWithClassName<TextLabel>;
		h1: TextInstancePropsWithClassName<TextLabel>;
		h2: TextInstancePropsWithClassName<TextLabel>;
		h3: TextInstancePropsWithClassName<TextLabel>;
		h4: TextInstancePropsWithClassName<TextLabel>;
		h5: TextInstancePropsWithClassName<TextLabel>;
		h6: TextInstancePropsWithClassName<TextLabel>;
		img: InstancePropsWithClassName<ImageLabel>;
		button: TextInstancePropsWithClassName<TextButton>;
		input: TextInstancePropsWithClassName<TextBox>;
		video: InstancePropsWithClassName<VideoFrame>;
	}
}
