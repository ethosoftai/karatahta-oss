from manim import *


class ProgressiveBenchmark(Scene):
    def construct(self):
        title = Text("Kara Tahta", font_size=48).to_edge(UP)
        circle = Circle(radius=1.2, color=BLUE)
        square = Square(side_length=2.1, color=YELLOW)
        formula = Text("alan = taban × yükseklik", font_size=34).to_edge(DOWN)

        self.play(Write(title), run_time=2)
        self.play(Create(circle), run_time=3)
        self.wait(2)
        self.play(Transform(circle, square), run_time=3)
        self.play(Write(formula), run_time=3)
        self.wait(3)
        self.play(FadeOut(circle, formula, title), run_time=3)

